import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

const serverOnlyConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
  ],
};

export const serverConfig: ApplicationConfig = mergeApplicationConfig(appConfig, serverOnlyConfig);
