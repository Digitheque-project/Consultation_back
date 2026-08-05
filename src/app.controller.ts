import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Point d\'entrée de l\'API',
    description: 'Retourne un message de bienvenue pour l\'API du CHU Andrainjato Fianarantsoa'
  })
  @ApiResponse({
    status: 200,
    description: 'Message de bienvenue',
    schema: {
      type: 'string',
      example: 'Bienvenue sur l\'API du CHU Andrainjato Fianarantsoa'
    }
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
