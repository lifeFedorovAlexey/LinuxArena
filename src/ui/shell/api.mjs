export async function api(path, data) {
  const response = await fetch(
    `/api/${path}`,
    data === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Ошибка ${response.status}`);
  return payload;
}
