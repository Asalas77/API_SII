import { Controller, Get } from '@nestjs/common';
import { Publico } from './auth/index.js';
import { AppService, type InfoApi } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Publico()
  getInfo(): InfoApi {
    return this.appService.getInfo();
  }
}
