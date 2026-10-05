// The web app: the shared app, plus the landing page and the offline copy, which only the website has.
// The landing styles come first, so the shared styles still follow them as before.
import './landing.css';
import { saveDrafts, start } from '../app';
import { landing } from './landing';
import { registerOffline } from './offline';

start({ landing });
registerOffline(saveDrafts);
