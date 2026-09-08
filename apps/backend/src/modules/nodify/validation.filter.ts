import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
@Catch(ZodError, Prisma.PrismaClientKnownRequestError)
export class NodifyValidationFilter implements ExceptionFilter {
    catch(exception: ZodError | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
        if (exception instanceof Prisma.PrismaClientKnownRequestError) {
            const status =
                exception.code === 'P2025'
                    ? 404
                    : ['P2002', 'P2003'].includes(exception.code)
                      ? 409
                      : 500;
            return host
                .switchToHttp()
                .getResponse()
                .status(status)
                .json({
                    statusCode: status,
                    message:
                        exception.code === 'P2025'
                            ? '资源不存在'
                            : exception.code === 'P2002'
                              ? '名称或标识已存在'
                              : exception.code === 'P2003'
                                ? '资源仍被使用，请先解除关联'
                                : '数据库操作失败',
                });
        }
        host.switchToHttp()
            .getResponse()
            .status(400)
            .json({
                statusCode: 400,
                message: exception.issues.map(
                    (issue) => `${issue.path.join('.')}: ${issue.message}`,
                ),
            });
    }
}
