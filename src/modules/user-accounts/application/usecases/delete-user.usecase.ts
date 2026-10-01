import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UsersCommandRepository } from '../../infrastructure/users.command-repository';
import { DomainException } from '../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../core/exceptions/domain-exception-codes';

export class DeleteUserCommand extends Command<void> {
    constructor(public readonly id: string) {
        super();
    }
}

@CommandHandler(DeleteUserCommand)
export class DeleteUserHandler implements ICommandHandler<DeleteUserCommand> {
    constructor(
        private readonly usersCommandRepository: UsersCommandRepository,
    ) {}

    async execute(command: DeleteUserCommand): Promise<void> {
        const { id } = command;

        const user =
            await this.usersCommandRepository.SQLfindUserById(id);

        if (!user) {
            throw new DomainException({
                code: DomainExceptionCode.UserNotFound,
                message: 'User not found',
            });
        }

        user.makeDeleted();

        await this.usersCommandRepository.SQLsave(user);
    }
}
