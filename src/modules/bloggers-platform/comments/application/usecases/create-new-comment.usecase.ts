import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CommentViewDto } from '../../api/view-dto/comments.view-dto';
import { CreateCommentApiInputDto } from '../../api/input-dto/create-comment.api.input-dto';
import { UsersExternalQueryRepository } from '../../../../user-accounts/infrastructure/external-query/users.external-query-repository';
import { InjectModel } from '@nestjs/mongoose';
import { Comment, CommentModelType } from '../../domain/comment.entity';
import { CommentsCommandRepository } from '../../infrastructure/comments.command-repository';
import { UserAccessTokenContextDto } from '../../../../authorisation/guards/dto/user-access-token-context.dto';
import { PostsQueryRepository } from '../../../posts/infrastructure/query/posts.query-repository';
import { DomainException } from '../../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../../core/exceptions/domain-exception-codes';
import { SQLComment } from '../../domain/sql-comment.entity';
import { CommentsQueryRepository } from '../../infrastructure/query/comments.query-repository';

export class CreateNewComment extends Command<CommentViewDto> {
    constructor(
        public readonly postId: string,
        public readonly body: CreateCommentApiInputDto,
        public readonly userId: string,
    ) {
        super();
    }
}

@CommandHandler(CreateNewComment)
export class CreateNewCommentHandler implements ICommandHandler<CreateNewComment> {
    constructor(
        private usersExternalQueryRepository: UsersExternalQueryRepository,
        private postsQueryRepository: PostsQueryRepository,
        @InjectModel(Comment.name) private CommentModel: CommentModelType,
        private commentsCommandRepository: CommentsCommandRepository,
        private commentsQueryRepository: CommentsQueryRepository,
    ) {}

    async execute({
        postId,
        body,
        userId,
    }: CreateNewComment): Promise<CommentViewDto> {

        if (!(await this.postsQueryRepository.SQLifPostExists(postId))) {
            throw new DomainException({
                code: DomainExceptionCode.PostNotFound,
                message: 'Post not found',
            });
        }

        console.warn('<---- userId to be written inside new comment: ', userId);
        const comment = SQLComment.createInstance({content: body.content, postId, userId});

        const commentId = await this.commentsCommandRepository.SQLsaveCreate(comment);

        const commentView = await this.commentsQueryRepository.SQLgetCommentById(commentId);
        console.warn('<---- userId written inside new comment (commentView?.commentatorInfo.userId): ', commentView?.commentatorInfo?.userId);


        if (!commentView) {
            throw new DomainException({
                code: DomainExceptionCode.CommentNotFound,
                message: ' Comment not found: apparently newly formed comment couldn\'t be found in database!',
            });
        }

        return commentView;
    }
}
