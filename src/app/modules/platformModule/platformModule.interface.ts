export interface IPlatformModule {
  name: string;
  code: string; // e.g., 'RESTAURANT', 'HOSPITALITY'
  description?: string;
  isActive: boolean;
  basePrice: number;
}
