import { expressionMatches, matchLimitMessage } from './find';
// Only advanced regex matching runs here. The owner terminates every request after 1 s.
self.onmessage = ({ data }) => {
  try {
    const expression = new RegExp(data.query, data.caseSensitive ? 'g' : 'gi');
    self.postMessage({ matches: expressionMatches(data.text, expression, data.wholeWord) });
  } catch (error) {
    const tooMany = error instanceof Error && error.message === matchLimitMessage;
    const message = tooMany ? matchLimitMessage : 'Invalid regular expression: ' + String(error);
    self.postMessage({ error: message });
  }
};
