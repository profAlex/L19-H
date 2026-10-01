import { UpdateBlogInputDto } from '../../dto/create-blog.dto';
import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { BlogsCommandRepository } from '../../infrastructure/blogs.command-repository';
import { DomainException } from '../../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../../core/exceptions/domain-exception-codes';

export class UpdateBlogCommand extends Command<void>{
    constructor(
        public readonly blogId: string,
        public readonly dto: UpdateBlogInputDto,
    ) {
        super();
    }
}

@CommandHandler(UpdateBlogCommand)
export class UpdateBlogHandler implements ICommandHandler<UpdateBlogCommand>
{
    constructor(
        private readonly blogsCommandRepository: BlogsCommandRepository,
    ) {}

    async execute(command: UpdateBlogCommand): Promise<void> {
        const { blogId, dto } = command;

        // находим запись и создаем(восстанавливаем) доменную сущность
        const blog = await this.blogsCommandRepository.SQLfindBlogById(blogId);

        if (!blog) {
            throw new DomainException({
                code: DomainExceptionCode.BlogNotFound,
                message: `Blog with id ${blogId} not found`,
            });
        }

        // вызываем доменный метод у самой сущности (изменяет поля и updatedAt)
        blog.updateBlog(dto);

        // сохраняем измененную сущность обратно в БД
        await this.blogsCommandRepository.SQLsaveUpdate(blog);
    }
}