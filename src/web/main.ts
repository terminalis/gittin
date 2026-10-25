// The web app: the shared app, plus the offline copy, which only the website has.
import { saveDrafts, start } from '../app';
import { registerOffline } from './offline';

start();
registerOffline(saveDrafts);
