import mongoose, { Document, Schema, Types } from 'mongoose';

// ─── Block ────────────────────────────────────────────────────────────────────

export interface IBlock extends Document {
  _id: Types.ObjectId;
  sha256: string;
  createdAt: number;
  updatedAt: number;
  linkCount: number;
  size: number;
  isInvalid: boolean;
  invalidatedAt?: number;
}

const blockSchema = new Schema<IBlock>({
  sha256: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  linkCount: { type: Number, default: 1 },
  size: { type: Number },
  isInvalid: { type: Boolean, index: true, default: false },
  invalidatedAt: { type: Number, index: true },
});

// Partial unique index on sha256 - only for valid blocks (isInvalid: false)
// Note: MongoDB partialFilterExpression only supports $eq, not $ne
blockSchema.index(
  { sha256: 1 },
  { unique: true, partialFilterExpression: { isInvalid: { $eq: false } } }
);

// ─── Entry ───────────────────────────────────────────────────────────────────

export interface IUploadConfig {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  readOnly?: boolean;
}

export interface IEntry extends Document {
  _id: Types.ObjectId;
  name: string;
  alias: string;
  isDefault?: boolean;
  order?: number;
  createdAt: number;
  updatedAt: number;
  description: string;
  isInvalid: boolean;
  invalidatedAt?: number;
  uploadConfig?: IUploadConfig;
}

const entrySchema = new Schema<IEntry>({
  name: { type: String, required: true, trim: true },
  // AI-CONTRACT: unique(alias) scoped by isInvalid != true
  alias: { type: String, default: '', trim: true, index: true },
  isDefault: { type: Boolean, default: false },
  order: { type: Number },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  description: { type: String, default: '' },
  isInvalid: { type: Boolean, index: true, default: false },
  invalidatedAt: { index: true, type: Number },
  uploadConfig: {
    maxFileSize: { type: Number },
    allowedMimeTypes: [{ type: String }],
    readOnly: { type: Boolean, default: false },
  },
});

// Enforce single default entry at DB level (partial unique index)
entrySchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true, isInvalid: false } }
);

// ─── Resource ─────────────────────────────────────────────────────────────────

export interface IResource extends Document {
  _id: Types.ObjectId;
  block: Types.ObjectId | IBlock;
  mime?: string;
  entry: Types.ObjectId | IEntry;
  category?: string;
  description: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  isInvalid: boolean;
  invalidatedAt?: number;
  clientIp?: string;
  userAgent?: string;
  uploadDuration?: number;
}

export interface IResourcePopulated extends Omit<IResource, 'block' | 'entry'> {
  block: IBlock;
  entry: Types.ObjectId;
}

export interface IResourceHistory extends Document {
  _id: Types.ObjectId;
  resourceId: Types.ObjectId;
  fromBlockId: Types.ObjectId;
  toBlockId: Types.ObjectId;
  action: 'swap' | 'rollback';
  changedAt: number;
  changedBy?: string;
  reason?: string;
  requestId?: string;
  rollbackable: boolean;
}

const resourceSchema = new Schema<IResource>({
  block: { type: Schema.Types.ObjectId, required: true, ref: 'Block', index: true },
  mime: { type: String, index: true },
  entry: { type: Schema.Types.ObjectId, required: true, ref: 'Entry', index: true },
  category: { type: String, index: true },
  description: { type: String, default: '', trim: true },
  name: { type: String, default: '', trim: true },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  lastAccessedAt: { type: Number, default: Date.now, index: true },
  isInvalid: { type: Boolean, index: true, default: false },
  invalidatedAt: { type: Number, index: true },
  clientIp: { type: String, index: true },
  userAgent: { type: String },
  uploadDuration: { type: Number },
});

const resourceHistorySchema = new Schema<IResourceHistory>({
  resourceId: { type: Schema.Types.ObjectId, required: true, ref: 'Resource', index: true },
  fromBlockId: { type: Schema.Types.ObjectId, required: true, ref: 'Block', index: true },
  toBlockId: { type: Schema.Types.ObjectId, required: true, ref: 'Block', index: true },
  action: { type: String, enum: ['swap', 'rollback'], required: true, default: 'swap' },
  changedAt: { type: Number, default: Date.now, index: true },
  changedBy: { type: String },
  reason: { type: String },
  requestId: { type: String, index: true },
  rollbackable: { type: Boolean, default: true },
});

resourceHistorySchema.index({ resourceId: 1, changedAt: -1 });
resourceHistorySchema.index({ toBlockId: 1, changedAt: -1 });

export const Block = mongoose.model<IBlock>('Block', blockSchema);
export const Resource = mongoose.model<IResource>('Resource', resourceSchema);
export const ResourceHistory = mongoose.model<IResourceHistory>('ResourceHistory', resourceHistorySchema);
export const Entry = mongoose.model<IEntry>('Entry', entrySchema);

// Re-export LogEntry and types from logEntry.ts
export { LogEntry } from './logEntry';
export type { ILogEntry } from './logEntry';
