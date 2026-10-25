export type Route = { screen: 'home' } | { screen: 'editor'; id: string };
export function readRoute(): Route {
  const match = location.hash.match(/^#\/document\/([^/]+)$/);
  if (match) {
    try {
      return { screen: 'editor', id: decodeURIComponent(match[1]) };
    } catch {}
  }
  return { screen: 'home' };
}
export function writeRoute(route: Route) {
  history.replaceState(null, '', route.screen === 'editor' ? '#/document/' + encodeURIComponent(route.id) : '#/home');
}
