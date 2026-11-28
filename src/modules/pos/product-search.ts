export type PosSearchProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

export function createPosProductSearchIndex<T extends PosSearchProduct>(products: readonly T[]) {
  const exactByCode = new Map<string, T | null>();
  const addExactCode = (code: string, product: T) => {
    const key = normalized(code);
    const current = exactByCode.get(key);
    if (current && current.id !== product.id) {
      exactByCode.set(key, null);
    } else if (!exactByCode.has(key)) {
      exactByCode.set(key, product);
    }
  };
  for (const product of products) {
    addExactCode(product.sku, product);
    if (product.barcode) addExactCode(product.barcode, product);
  }

  return {
    findExact(value: string) {
      const query = normalized(value);
      return query ? exactByCode.get(query) ?? null : null;
    },
    search(value: string, limit = 20) {
      const query = normalized(value);
      if (!query) return products.slice(0, limit);
      return products.filter((product) =>
        normalized(product.sku).includes(query) ||
        normalized(product.name).includes(query) ||
        normalized(product.barcode ?? "").includes(query),
      ).slice(0, limit);
    },
  };
}
