// The web app: the shared app, plus the landing page, the offline copy and installing, which only the website has.
// The landing styles come first, so the shared styles still follow them as before.
import './landing.css';
import { saveDrafts, start } from '../app';
import { install, watchInstallOffer } from './install';
import { landing } from './landing';
import { registerOffline } from './offline';

watchInstallOffer();
start({ landing, install });
registerOffline(saveDrafts);
