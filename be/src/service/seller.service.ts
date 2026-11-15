import { sellerById, sellerList } from '../repository/seller.repo.js';
import type { SellerParams } from '../types/seller.js';

export const sellerListService = (params: SellerParams) => sellerList(params);

export const sellerByIdService = (sellerId: string) => sellerById(sellerId);
