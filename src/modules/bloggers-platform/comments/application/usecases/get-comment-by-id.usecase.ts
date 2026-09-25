import { IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';
import { CommentViewDto } from '../../api/view-dto/comments.view-dto';
import { CommentsQueryRepository } from '../../infrastructure/query/comments.query-repository';
import { CommentLikesQueryRepository } from '../../../likes/infrastructure/query/comment-likes.query-repository';
import { DomainException } from '../../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../../core/exceptions/domain-exception-codes';

export class GetCommentById extends Query<CommentViewDto> {
    constructor(
        public readonly commentId: string,
        public readonly userId: string | undefined,
    ) {
        super();
    }
}

@QueryHandler(GetCommentById)
export class GetCommentByIdHandler implements IQueryHandler<GetCommentById> {
    constructor(
        private commentsQueryRepository: CommentsQueryRepository,
        private commentLikesQueryRepository: CommentLikesQueryRepository,
    ) {}

    // тут обрабатываем два сценария - аноноимный (user = undefined) и неанонимный запрос
    async execute({ commentId, userId }: GetCommentById): Promise<CommentViewDto> {
        const commentView = await this.commentsQueryRepository.SQLgetCommentById(
            commentId,
            userId,
        );

        if (!commentView) {
            // throw new NotFoundException("Comment not found!");
            throw new DomainException({
                code: DomainExceptionCode.CommentNotFound,
                message: 'Comment not found!',
            });
        }

        return commentView;
    }
}
