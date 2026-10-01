// <void> - This type represents the command execution result
import { CreatePostLikeDto } from '../../../posts/dto/create-post-like.dto';
import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateCommentLikeDto } from '../../dto/create-comment-like.dto';
import {
    CommentLike,
    CommentLikeModelType,
} from '../../../likes/domain/comment-like.entity';
import { InjectModel } from '@nestjs/mongoose';
import { UsersExternalQueryRepository } from '../../../../user-accounts/infrastructure/external-query/users.external-query-repository';
import { CommentsCommandRepository } from '../../infrastructure/comments.command-repository';
import { DomainException } from '../../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../../core/exceptions/domain-exception-codes';
import { CommentLikesCommandRepository } from '../../../likes/infrastructure/comment-likes.command-repository';
import { CommentLikesQueryRepository } from '../../../likes/infrastructure/query/comment-likes.query-repository';

export class ChangeCommentLikeStatus extends Command<void> {
    constructor(public readonly dto: CreateCommentLikeDto) {
        super();
    }
}

@CommandHandler(ChangeCommentLikeStatus)
export class ChangeCommentLikeStatusHandler implements ICommandHandler<ChangeCommentLikeStatus> {
    constructor(
        @InjectModel(CommentLike.name)
        private CommentLikeModel: CommentLikeModelType,
        private commentLikesCommandRepository: CommentLikesCommandRepository,
        private commentLikesQueryRepository: CommentLikesQueryRepository,
        private commentsCommandRepository: CommentsCommandRepository,
        private usersExternalQueryRepository: UsersExternalQueryRepository,
    ) {}

    async execute({ dto }: ChangeCommentLikeStatus): Promise<void> {
        const { commentId, userId, newLikeStatus } = dto;

        // новый порядок для postgreSQL:
        // запрашиваем статус коммента, на случай если он не существует и новый статус None -
        // нам собственно ничего менять не нужно, а если новый статус отличен от None,
        // то соответствующим образом апдейтить запись о комменте

        // сначала проверяем что коммент вообще существует, т.е. и пост к которому комментарий относится существует,
        // а также существует и блог к которому относится пост
        const ifCommentExists =
            await this.commentsCommandRepository.SQLifCommentExists(
                commentId,
            );

        if (!ifCommentExists) {
            throw new DomainException({
                code: DomainExceptionCode.CommentNotFound,
                message: `Comment not found`,
            });
        }

        // теперь вычисляем существующий статус лайка-дизлайка (если он есть вообще)
        const currentLikeStatus =
            await this.commentLikesCommandRepository.SQLgetLikeByCommentIdAndUserId(
                {
                    commentId,
                    userId,
                },
            );
        // *********************

        // НАЧАЛО ПРОВЕРОК
        // если прежней реакции не найдено и новая реакция не None, значит реакция добавляется впервые
        // и надо будет просто увеличить счетчик лайков или дислайков и добавить новую запись в
        if (currentLikeStatus === null && newLikeStatus !== 'None') {
            // создаем новый лайк в базе
            await this.commentLikesCommandRepository.SQLupdateLikeStatus(commentId, userId, newLikeStatus);

            // меняем счетчик
            if (newLikeStatus === 'Like') {
                await this.commentsCommandRepository.SQLchangeCommentLikesCounter(commentId, 1);
            }
            else if (newLikeStatus === 'Dislike') {
                await this.commentsCommandRepository.SQLchangeCommentDislikesCounter(commentId, 1);
            }
        }
        // если прежняя реакция найдена и она не равна вновь переданной
        else if (
            currentLikeStatus !== null &&
            currentLikeStatus !== newLikeStatus
        ) {
            // если новая реакция это None, тогда надо удалить запись лайка в репозитории лайков и сбросить реакцию в комменте
            if (newLikeStatus === 'None') {
                // выставляем статус лайка (запись в базе) likeStatus в None, не удаляя физически
                await this.commentLikesCommandRepository.SQLupdateLikeStatus(commentId, userId, newLikeStatus);

                // делаем декремент счетчика лайка или дизлайка
                if(currentLikeStatus === 'Like'){
                    await this.commentsCommandRepository.SQLchangeCommentLikesCounter(commentId, -1);
                }
                else if (currentLikeStatus === 'Dislike') {
                    await this.commentsCommandRepository.SQLchangeCommentDislikesCounter(commentId, -1);
                }

            } else {
                // ветка на тот случай когда мы меняем(свитчим) реакцию на Like или Dislike (sentLike === "Like" или "Dislike")
                // меняем реакцию в коллекции лайков на новую
                await this.commentLikesCommandRepository.SQLupdateLikeStatus(commentId, userId, newLikeStatus);


                // меняем каунтер в комменте
                if(newLikeStatus === 'Like') {
                    await this.commentsCommandRepository.SQLswitchToLikeCommentCounter(commentId);
                }
                else if(newLikeStatus === 'Dislike') {
                    await this.commentsCommandRepository.SQLswitchToDislikeCommentCounter(commentId);
                }
            }
        }
    }
}
