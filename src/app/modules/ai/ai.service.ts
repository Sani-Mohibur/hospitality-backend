import Anthropic from '@anthropic-ai/sdk';
import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { z } from 'zod';
import config from '../../config';
import AppError from '../../errors/AppError';
import { ReportService } from '../report/report.service';
import { HotelInventory } from '../hospitality/inventory/hotelInventory.service';
import { AlertService } from '../alert/alert.service';
import { InventoryServices } from '../inventory/inventory.service';
import { Location } from '../location/location.model';
import logger from '../../utils/logger';

// AI ops assistant: answers an owner's plain-language question from their own data.
// Claude can only call the read-only report tools below, each limited to the caller's
// tenant (request context) and to locations the caller may see.

const client = config.ai.anthropic_api_key ? new Anthropic({ apiKey: config.ai.anthropic_api_key }) : undefined;

const MAX_TURNS = 8;

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeArgs = z.object({ from: dateArg, to: dateArg, locationId: z.string().optional() });

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_dashboard',
    description:
      'KPIs for a business-date range: occupancy, ADR, RevPAR, TRevPAR, F&B covers, average check, sales mix, ticket times, in-house capture rate, voids/comps/discounts. Money values are integers in minor units (cents).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start business date YYYY-MM-DD' },
        to: { type: 'string', description: 'End business date YYYY-MM-DD (inclusive)' },
        locationId: { type: 'string', description: 'Optional location id; omit for all locations the user can see' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_sales',
    description: 'Outlet sales for a date range grouped by item, category, outlet, staff, hour or day. Money in minor units.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        groupBy: { type: 'string', enum: ['item', 'category', 'outlet', 'staff', 'hour', 'day'] },
        locationId: { type: 'string' },
      },
      required: ['from', 'to', 'groupBy'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_payments',
    description: 'Payments received in a date range by payment method (amount, tips, refunds, platform fees). Money in minor units.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, locationId: { type: 'string' } },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_availability',
    description: 'Rooms available, sold and held per room type per night for a future date range at one location.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, locationId: { type: 'string' } },
      required: ['from', 'to', 'locationId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_food_cost',
    description: 'Theoretical vs actual food cost and waste for a date range at one location. Money in minor units.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' }, locationId: { type: 'string' } },
      required: ['from', 'to', 'locationId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_open_alerts',
    description: 'Open operational alerts (dirty rooms before arrivals, late kitchen tickets, low stock, overdue deposits...).',
    input_schema: { type: 'object', properties: { locationId: { type: 'string' } }, additionalProperties: false },
    strict: true,
  },
];

type TScope = { allLocations: boolean; locationIds: string[] };

const allowedLocation = (scope: TScope, locationId?: string) => {
  if (!locationId) return undefined;
  if (!Types.ObjectId.isValid(locationId)) throw new Error('Unknown location id');
  if (!scope.allLocations && !scope.locationIds.includes(locationId)) throw new Error('No access to that location');
  return locationId;
};

const filterFor = (scope: TScope, locationId?: string) => {
  const one = allowedLocation(scope, locationId);
  if (one) return { locationIds: [new Types.ObjectId(one)] };
  if (scope.allLocations) return {};
  return { locationIds: scope.locationIds.map((id) => new Types.ObjectId(id)) };
};

const runTool = async (name: string, input: unknown, scope: TScope) => {
  switch (name) {
    case 'get_dashboard': {
      const a = rangeArgs.parse(input);
      return ReportService.dashboard(filterFor(scope, a.locationId), a.from, a.to);
    }
    case 'get_sales': {
      const a = rangeArgs.extend({ groupBy: z.enum(['item', 'category', 'outlet', 'staff', 'hour', 'day']) }).parse(input);
      return (await ReportService.sales(filterFor(scope, a.locationId), a.from, a.to, a.groupBy)).slice(0, 50);
    }
    case 'get_payments': {
      const a = rangeArgs.parse(input);
      return ReportService.paymentsReport(filterFor(scope, a.locationId), new Date(`${a.from}T00:00:00Z`), new Date(`${a.to}T23:59:59Z`));
    }
    case 'get_availability': {
      const a = rangeArgs.extend({ locationId: z.string() }).parse(input);
      return HotelInventory.availability(allowedLocation(scope, a.locationId)!, a.from, a.to);
    }
    case 'get_food_cost': {
      const a = rangeArgs.extend({ locationId: z.string() }).parse(input);
      return InventoryServices.foodCost(allowedLocation(scope, a.locationId)!, new Date(`${a.from}T00:00:00Z`), new Date(`${a.to}T23:59:59Z`));
    }
    case 'get_open_alerts': {
      const a = z.object({ locationId: z.string().optional() }).parse(input ?? {});
      const one = allowedLocation(scope, a.locationId);
      return (await AlertService.list(one ? { locationId: new Types.ObjectId(one) } : {}, { limit: 50 })).data;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
};

// Stable instructions first so the prompt prefix stays cacheable; per-request facts go
// into the user turn.
const SYSTEM_PROMPT = `You are the operations assistant inside HPOS, software for hotels and restaurants.
Answer the owner's or manager's question using only the tools, which read their own business data.
Money values from tools are integers in minor currency units (cents): divide by 100 when you present them.
Business dates are YYYY-MM-DD. When the user says "last weekend" or "this month", work out the dates from today's date given in the message.
Keep answers short: lead with the answer and the key numbers, then at most three bullet points of context or a suggested action.
If the data cannot answer the question, say what is missing instead of guessing.`;

const ask = async (question: string, scope: TScope, currency: string) => {
  if (!client) throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'The AI assistant is not configured (ANTHROPIC_API_KEY)');
  const locations = await Location.find(scope.allLocations ? {} : { _id: { $in: scope.locationIds } }).select('name businessDate').lean();
  const context = `Today: ${new Date().toISOString().slice(0, 10)}. Currency: ${currency}. Locations: ${locations
    .map((l) => `${l.name} (id ${l._id}, business date ${l.businessDate})`)
    .join('; ')}.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `${context}\n\nQuestion: ${question}` }];
  const toolCalls: { name: string; input: unknown }[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await client.beta.messages.create({
      model: config.ai.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      // Server-side refusal fallback, routed by refusal category.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    if (response.stop_reason === 'refusal') {
      return { answer: 'The assistant could not answer this question.', toolCalls };
    }
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      const answer = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { answer: answer || 'No answer was produced.', toolCalls, truncated: response.stop_reason === 'max_tokens' };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (use) => {
        toolCalls.push({ name: use.name, input: use.input });
        try {
          const data = await runTool(use.name, use.input, scope);
          return { type: 'tool_result' as const, tool_use_id: use.id, content: JSON.stringify(data).slice(0, 60_000) };
        } catch (err: any) {
          return { type: 'tool_result' as const, tool_use_id: use.id, content: `Error: ${err?.message || err}`, is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: results });
  }
  logger.warn({ question }, 'AI assistant hit the tool-turn limit');
  return { answer: 'That question needed too many lookups. Try asking for one thing at a time.', toolCalls };
};

export const AiService = { ask };
