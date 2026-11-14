/** 通用 HTTP 助手 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}
