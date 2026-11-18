import { Controller, Get } from '@nestjs/common';
import { AppService, type InfoApi } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getInfo(): InfoApi {
    return this.appService.getInfo();
  }
}
