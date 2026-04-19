export const handler = async () => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    ok: true,
    service: 'strandgaarden-api',
    stage: process.env.STAGE ?? 'unknown',
    time: new Date().toISOString(),
  }),
});
