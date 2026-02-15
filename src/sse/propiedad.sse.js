const clientes = new Set();

export const propiedadesSSE = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Permitir CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  clientes.add(res);

  // Cuando el cliente cierre conexión
  req.on("close", () => {
    clientes.delete(res);
  });
};

// Función para NOTIFICAR a todos los clientes
export const notificarCambioPropiedades = (evento, data) => {
  for (const cliente of clientes) {
    cliente.write(`event: ${evento}\n`);
    cliente.write(`data: ${JSON.stringify(data)}\n\n`);
  }
};