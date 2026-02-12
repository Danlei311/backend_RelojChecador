const tokenBlacklist = new Set();

// Agregar token a la lista negra
export const agregarTokenABlacklist = (token) => {
  tokenBlacklist.add(token);
};

// Verificar si un token está en la lista negra
export const estaEnBlacklist = (token) => {
  return tokenBlacklist.has(token);
};
