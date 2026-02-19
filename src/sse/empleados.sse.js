const clientes = new Set();

export const empleadosSSE = (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    clientes.add(res);

    req.on("close", () => {
        clientes.delete(res);
    });
};

export const notificarCambioEmpleados = (evento, data) => {
    for (const cliente of clientes) {
        cliente.write(`event: ${evento}\n`);
        cliente.write(`data: ${JSON.stringify(data)}\n\n`);
    }
};
