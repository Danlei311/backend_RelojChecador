
// Obtener la hora y fecha del servidor
export const getServerTime = (req, res) => {
    try {
        console.log('Solicitud de hora del servidor recibida');
        const now = new Date();

        res.status(200).json({
            success: true,
            data: {
                timestamp: now.getTime(),
                fechaISO: now.toISOString(),
                fecha: now.toLocaleDateString('es-MX', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }),
                hora: now.toLocaleTimeString('es-MX', {
                    hour12: false
                })
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error obteniendo hora del servidor'
        });
    }
};