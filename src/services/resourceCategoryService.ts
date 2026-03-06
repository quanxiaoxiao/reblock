import { Resource, ResourceCategory } from '../models';
import type { IResourceCategory } from '../models';
import {
  RESERVED_CATEGORY_KEY,
  assertValidColor,
  assertValidIconDataUri,
  slugifyCategoryName,
} from '../utils/resourceCategory';

export interface ResourceCategoryCreateParams {
  name: string;
  iconDataUri?: string | undefined;
  color?: string | undefined;
}

export interface ResourceCategoryUpdateParams {
  name?: string | undefined;
  iconDataUri?: string | undefined;
  color?: string | undefined;
}

export class ResourceCategoryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ResourceCategoryError';
  }
}

export class ResourceCategoryService {
  async list(): Promise<IResourceCategory[]> {
    return ResourceCategory.find({ isInvalid: { $ne: true } })
      .sort({ updatedAt: -1, _id: -1 })
      .exec();
  }

  async getByKey(key: string): Promise<IResourceCategory | null> {
    return ResourceCategory.findOne({ key, isInvalid: { $ne: true } }).exec();
  }

  async create(params: ResourceCategoryCreateParams): Promise<IResourceCategory> {
    const name = params.name.trim();
    if (!name) {
      throw new ResourceCategoryError('name is required', 400, 'INVALID_NAME');
    }

    assertValidColor(params.color);
    assertValidIconDataUri(params.iconDataUri);

    const key = await this.generateUniqueKey(name);
    const now = Date.now();

    const category = new ResourceCategory({
      key,
      name,
      iconDataUri: params.iconDataUri,
      color: params.color,
      createdAt: now,
      updatedAt: now,
      isInvalid: false,
    });

    return category.save();
  }

  async update(key: string, params: ResourceCategoryUpdateParams): Promise<IResourceCategory | null> {
    const category = await this.getByKey(key);
    if (!category) {
      return null;
    }

    if (typeof params.name === 'string') {
      const trimmedName = params.name.trim();
      if (!trimmedName) {
        throw new ResourceCategoryError('name is required', 400, 'INVALID_NAME');
      }
      category.name = trimmedName;
    }

    if (typeof params.iconDataUri === 'string') {
      assertValidIconDataUri(params.iconDataUri);
      category.iconDataUri = params.iconDataUri;
    } else if (params.iconDataUri === undefined) {
      // keep as-is
    } else {
      category.set('iconDataUri', undefined);
    }

    if (typeof params.color === 'string') {
      assertValidColor(params.color);
      category.color = params.color;
    } else if (params.color === undefined) {
      // keep as-is
    } else {
      category.set('color', undefined);
    }

    category.updatedAt = Date.now();
    return category.save();
  }

  async delete(key: string): Promise<IResourceCategory | null> {
    const category = await this.getByKey(key);
    if (!category) {
      return null;
    }

    const inUse = await Resource.countDocuments({
      categoryKey: key,
      isInvalid: { $ne: true },
    });
    if (inUse > 0) {
      throw new ResourceCategoryError('category is in use', 409, 'CATEGORY_IN_USE');
    }

    category.isInvalid = true;
    category.invalidatedAt = Date.now();
    category.updatedAt = category.invalidatedAt;
    return category.save();
  }

  async ensureCategoryKeyExists(categoryKey?: string): Promise<void> {
    if (!categoryKey) {
      return;
    }
    if (categoryKey === RESERVED_CATEGORY_KEY) {
      throw new ResourceCategoryError(
        `${RESERVED_CATEGORY_KEY} is reserved for filter semantics`,
        400,
        'INVALID_CATEGORY_KEY'
      );
    }
    const exists = await ResourceCategory.exists({ key: categoryKey, isInvalid: { $ne: true } });
    if (!exists) {
      throw new ResourceCategoryError('categoryKey does not exist', 400, 'CATEGORY_NOT_FOUND');
    }
  }

  private async generateUniqueKey(name: string): Promise<string> {
    const base = slugifyCategoryName(name);
    let index = 0;

    while (index < 1000) {
      const suffix = index === 0 ? '' : `-${index + 1}`;
      const candidate = `${base}${suffix}`;
      if (candidate === RESERVED_CATEGORY_KEY) {
        index += 1;
        continue;
      }

      const exists = await ResourceCategory.exists({ key: candidate, isInvalid: { $ne: true } });
      if (!exists) {
        return candidate;
      }
      index += 1;
    }

    throw new ResourceCategoryError('failed to allocate a unique category key', 500, 'KEY_ALLOCATION_FAILED');
  }
}

export const resourceCategoryService = new ResourceCategoryService();
