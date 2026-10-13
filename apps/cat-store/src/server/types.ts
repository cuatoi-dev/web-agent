// types.ts — shared shapes for the cat-store Express server modules.

export interface EsConfig {
  url: string; // CATSTORE_ES_URL,      e.g. http://elasticsearch:9200
  user: string; // CATSTORE_ES_USER
  password: string; // CATSTORE_ES_PASSWORD
}

/** Every field is optional; the store fills the rest. */
export interface CreateOrderInput {
  customer?: string;
  category?: string;
  total?: number;
  status?: string;
  itemCount?: number;
  items?: string;
}

export interface TestServer {
  url: string;
  close(): Promise<void>;
}
