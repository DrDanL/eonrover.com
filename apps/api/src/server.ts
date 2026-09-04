import { getApiConfig } from './config';

const config = getApiConfig();
const { createApp } = require('./app') as typeof import('./app');

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Eon Rover API listening on port ${config.port}`);
});
