import type { ProductCategory, ProductItem } from "./types";

export type { ProductItem, ProductCategory } from "./types";

export const CATEGORIES: ProductCategory[] = [
  "Food",
  "Toys",
  "Beds",
  "Grooming",
  "Health",
];

export const SEED_PRODUCTS: ProductItem[] = [
  { id: "p01", name: "Salmon Pâté",          category: "Food",     price: 3.99,  cost: 2.59,  inStock: true,  emoji: "🥫" },
  { id: "p02", name: "Tuna Crunchies",        category: "Food",     price: 4.49,  cost: 2.92,  inStock: true,  emoji: "🐟" },
  { id: "p03", name: "Chicken Kibble",        category: "Food",     price: 12.99, cost: 8.44,  inStock: true,  emoji: "🍗" },
  { id: "p04", name: "Organic Catnip",        category: "Food",     price: 6.99,  cost: 4.54,  inStock: true,  emoji: "🌿" },
  { id: "p05", name: "Feather Wand",          category: "Toys",     price: 8.99,  cost: 3.60,  inStock: true,  emoji: "🪶" },
  { id: "p06", name: "Laser Pointer",         category: "Toys",     price: 14.99, cost: 6.00,  inStock: true,  emoji: "🔴" },
  { id: "p07", name: "Crinkle Ball Set",      category: "Toys",     price: 5.49,  cost: 2.20,  inStock: false, emoji: "⚾" },
  { id: "p08", name: "Catnip Mouse",          category: "Toys",     price: 3.49,  cost: 1.40,  inStock: true,  emoji: "🐭" },
  { id: "p09", name: "Donut Cat Bed",         category: "Beds",     price: 29.99, cost: 12.60, inStock: true,  emoji: "🛏️" },
  { id: "p10", name: "Window Perch",          category: "Beds",     price: 39.99, cost: 16.80, inStock: true,  emoji: "🪟" },
  { id: "p11", name: "Fleece Blanket",        category: "Beds",     price: 19.99, cost: 8.40,  inStock: true,  emoji: "🛌" },
  { id: "p12", name: "Igloo Cave Bed",        category: "Beds",     price: 34.99, cost: 14.70, inStock: false, emoji: "🏠" },
  { id: "p13", name: "Slicker Brush",         category: "Grooming", price: 9.99,  cost: 6.49,  inStock: true,  emoji: "🪥" },
  { id: "p14", name: "Nail Clippers",         category: "Grooming", price: 7.49,  cost: 4.87,  inStock: true,  emoji: "✂️" },
  { id: "p15", name: "Flea & Tick Drops",     category: "Health",   price: 24.99, cost: 13.74, inStock: true,  emoji: "💊" },
  { id: "p16", name: "Dental Treats",         category: "Health",   price: 11.99, cost: 6.59,  inStock: true,  emoji: "🦷" },
];
