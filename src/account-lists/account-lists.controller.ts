import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccountListsService } from './account-lists.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateAccountsDto } from './dto';

@Controller('account-lists')
@UseGuards(JwtAuthGuard)
export class AccountListsController {
  constructor(private accountListsService: AccountListsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name: string,
    @Request() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!name) {
      throw new BadRequestException('List name is required');
    }

    return this.accountListsService.uploadFile(req.user.id, file, name);
  }

  @Get()
  async getUserAccountLists(@Request() req: any) {
    return this.accountListsService.getUserAccountLists(req.user.id);
  }

  @Get(':id')
  async getAccountList(@Param('id') id: string, @Request() req: any) {
    return this.accountListsService.getAccountListWithAccounts(id, req.user.id);
  }

  @Put(':id/accounts')
  async updateAccounts(
    @Param('id') id: string,
    @Body() updateAccountsDto: UpdateAccountsDto,
    @Request() req: any,
  ) {
    return this.accountListsService.updateAccounts(id, req.user.id, updateAccountsDto);
  }

  @Post(':id/publish')
  async publishAccountList(@Param('id') id: string, @Request() req: any) {
    return this.accountListsService.publishAccountList(id, req.user.id);
  }

  @Delete(':id')
  async deleteAccountList(@Param('id') id: string, @Request() req: any) {
    return this.accountListsService.deleteAccountList(id, req.user.id);
  }
}
