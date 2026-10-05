import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserAccessTokenContextDto } from '../guards/dto/user-access-token-context.dto';

export const ExtractUserIfExistsFromRequest = createParamDecorator(
    (data: unknown, context: ExecutionContext): UserAccessTokenContextDto | null => {

        // извлекаем HTTP-контекст из общего ExecutionContext
        const request = context.switchToHttp().getRequest();

        // если в request.user пусто, то возвращаем null (если в guard-е не обработан этот сценарий)
        if (!request.user) {
            return null;
        }

        // иначе возвращаем значение юзера
        return request.user;
    },
);

export const ExtractLoginIfUserExists = createParamDecorator(
    (data: unknown, context: ExecutionContext): UserAccessTokenContextDto | null => {
        const request = context.switchToHttp().getRequest();

        if (!request.user) {
            return null;
        }

        return request.user;
    },
);
