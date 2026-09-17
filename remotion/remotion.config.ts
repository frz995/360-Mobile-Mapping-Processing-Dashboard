import { Config } from '@remotion/cli/config';
import path from 'node:path';

// The app's public folder is the asset root for staticFile() — it already holds
// the module icons, branding and dashboard screenshots the compositions embed.
Config.setPublicDir(path.join(process.cwd(), '..', 'public'));
Config.setOverwriteOutput(true);
Config.setVideoImageFormat('jpeg');
Config.setPixelFormat('yuv420p');
Config.setCrf(19);