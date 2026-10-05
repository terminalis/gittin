export type Route = { screen: 'landing' | 'home' } | { screen: 'editor'; id: string };
export function readRoute(): Route {
  const match = location.hash.match(/^#\/document\/([^/]+)$/);
  if (match) {
    try {
      return { screen: 'editor', id: decodeURIComponent(match[1]) };
    } catch {}
  }
  return { screen: location.hash === '#/home' ? 'home' : 'landing' };
}
const addresses = { landing: '#/', home: '#/home' };
export function writeRoute(route: Route) {
  history.replaceState(null, '', route.screen === 'editor'
    ? '#/document/' + encodeURIComponent(route.id)
    : addresses[route.screen]);
}
