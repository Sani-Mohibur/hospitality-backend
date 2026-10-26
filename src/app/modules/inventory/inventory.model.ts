import { Schema, model } from 'mongoose';
import {
  IInventoryItem,
  IPurchaseOrder,
  IRecipe,
  IStockCount,
  IStockMovement,
  ISupplier,
  MOVEMENT_TYPE,
  PO_STATUS,
} from './inventory.interface';

const inventoryItemSchema = new Schema<IInventoryItem>(
  {
    name: { type: String, required: true },
    sku: { type: String, required: true, uppercase: true, trim: true },
    category: { type: String },
    unitOfMeasure: { type: String, required: true },
    quantity: { type: Number, required: true, default: 0 },
    unitCost: { type: Number, required: true, default: 0 },
    parLevel: { type: Number, min: 0 },
    reorderPoint: { type: Number, min: 0 },
    reorderQty: { type: Number, min: 0 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    isMinibar: { type: Boolean, default: false },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

inventoryItemSchema.index({ tenantId: 1, locationId: 1, sku: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

inventoryItemSchema.pre(['find', 'findOne', 'countDocuments'], function () {
  this.where({ isDeleted: { $ne: true } });
});

export const InventoryItem = model<IInventoryItem>('InventoryItem', inventoryItemSchema);

const stockMovementSchema = new Schema<IStockMovement>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    type: { type: String, enum: Object.values(MOVEMENT_TYPE), required: true },
    quantity: { type: Number, required: true },
    unitCost: { type: Number, default: 0 },
    quantityAfter: { type: Number, required: true },
    reason: { type: String },
    ref: { kind: String, id: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ tenantId: 1, stockItemId: 1, createdAt: -1 });
stockMovementSchema.index({ tenantId: 1, locationId: 1, type: 1, createdAt: -1 });

export const StockMovement = model<IStockMovement>('StockMovement', stockMovementSchema);

const recipeSchema = new Schema<IRecipe>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    yieldNote: { type: String },
    ingredients: [new Schema({ sku: { type: String, required: true, uppercase: true }, quantity: { type: Number, required: true, min: 0 } }, { _id: false })],
    modifierIngredients: [
      new Schema(
        { optionId: { type: Schema.Types.ObjectId, required: true }, sku: { type: String, required: true, uppercase: true }, quantity: { type: Number, required: true, min: 0 } },
        { _id: false },
      ),
    ],
  },
  { timestamps: true },
);

recipeSchema.index({ tenantId: 1, menuItemId: 1 }, { unique: true });

export const Recipe = model<IRecipe>('Recipe', recipeSchema);

const supplierSchema = new Schema<ISupplier>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true },
    code: { type: String, uppercase: true, trim: true },
    contactName: { type: String },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    taxNumber: { type: String },
    leadTimeDays: { type: Number, default: 2, min: 0 },
    notes: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Supplier = model<ISupplier>('Supplier', supplierSchema);

const purchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    number: { type: String, required: true },
    status: { type: String, enum: Object.values(PO_STATUS), default: PO_STATUS.DRAFT },
    lines: [
      new Schema(
        {
          stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
          quantity: { type: Number, required: true, min: 0 },
          unitCost: { type: Number, required: true, min: 0 },
          receivedQty: { type: Number, default: 0, min: 0 },
        },
        { _id: false },
      ),
    ],
    expectedAt: { type: Date },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    sentAt: { type: Date },
    receivedAt: { type: Date },
  },
  { timestamps: true },
);

purchaseOrderSchema.index({ tenantId: 1, number: 1 }, { unique: true });

export const PurchaseOrder = model<IPurchaseOrder>('PurchaseOrder', purchaseOrderSchema);

const stockCountSchema = new Schema<IStockCount>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true },
    status: { type: String, enum: ['OPEN', 'POSTED'], default: 'OPEN' },
    lines: [
      new Schema(
        { stockItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true }, expected: { type: Number, required: true }, counted: { type: Number } },
        { _id: false },
      ),
    ],
    countedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    postedAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true },
);

export const StockCount = model<IStockCount>('StockCount', stockCountSchema);
