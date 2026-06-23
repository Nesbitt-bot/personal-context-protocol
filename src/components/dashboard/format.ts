export function formatDate(value?: string | null) {
  if (!value) return 'No activity yet';
  return new Date(value).toLocaleString();
}