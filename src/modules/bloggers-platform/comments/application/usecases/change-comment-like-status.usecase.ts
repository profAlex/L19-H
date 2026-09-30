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
        /*
        
                const checkEmailQuery = `
                    SELECT EXISTS (
                        SELECT 1
                        FROM public."users"
                        WHERE "email" = $1 AND "deleted_at" IS NULL
                    ) as "exists";
                `;
                const [emailResult] = await this.dataSource.query<{ exists: boolean }[]>(
                    checkEmailQuery,
                    [email],
                );
        */

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
        const commentLikeStatus =
            await this.commentLikesCommandRepository.SQLgetLikeByCommentIdAndUserId(
                {
                    commentId,
                    userId,
                },
            );
        // *********************

        // // проверяем что коммент, которому пользователь меняет лайк-статус существует и сразу возращаем ссылку для работы
        // const comment =
        //     await this.commentsCommandRepository.getCommentById(commentId);
        // if (!comment) {
        //     throw new DomainException({
        //         code: DomainExceptionCode.CommentNotFound,
        //         message: `Comment not found`,
        //     });
        // }
        //
        // // проверяем наличие реакции на коммент в коллекции коммент-лайков и если он существует сразу возвращаем документ для изменения
        // const previousReactionStatus =
        //     await this.commentLikesCommandRepository.findSingleCommentLikeByCommentIdAndUserId(
        //         { commentId, userId },
        //     );
        //
        // // находим данные юзера, который меняет реакицю, нам нужен будет от него userLogin
        // const user =
        //     await this.usersExternalQueryRepository.getByIdOrNotFoundFail(
        //         userId,
        //     );

        // НАЧАЛО ПРОВЕРОК
        // если прежней реакции не найдено и новая реакция не None, значит реакция добавляется впервые
        // и надо будет просто увеличить счетчик лайков или дислайков и добавить новую запись в
        if (commentLikeStatus === null && newLikeStatus !== 'None') {
            // создаем новый лайк в базе

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
            commentLikeStatus !== null &&
            commentLikeStatus !== newLikeStatus
        ) {
            // дополнительное условие - если передали лайк = none - удалить запись из лайк репозитория,
            // не забыть вызвать nullifyReaction для корректировки общего счетчика лайков-дизлайков

            // если новая реакция это None, тогда надо удалить запись лайка в репозитории лайков и сбросить реакцию в комменте
            if (newLikeStatus === 'None') {
                // запоминаем какая реакция была ранее проставлена юзером
                const previousReaction = previousReactionStatus.likeStatus;

                // выставляем статус лайка (запись в базе) likeStatus в None, не удаляя физически
                const isStatusChanged = previousReactionStatus.updateLikeStatus(
                    { likeStatus: newLikeStatus },
                );

                if (isStatusChanged) {
                    await this.commentLikesCommandRepository.save(
                        previousReactionStatus,
                    );
                }

                // делаем декремент счетчика лайка или дизлайка
                const ifNullifyingReactionSuccessfull =
                    await this.commentsCommandRepository.nullifyCommentReaction(
                        {
                            sentCommentId: commentId,
                            oldStatus: previousReaction,
                        },
                    );

                if (!ifNullifyingReactionSuccessfull) {
                    throw new DomainException({
                        code: DomainExceptionCode.PostNotFound,
                        message: `Post not found`,
                    });
                }
            } else {
                // ветка на тот случай когда мы меняем(свитчим) реакцию на Like или Dislike (sentLike === "Like" или "Dislike")
                // меняем реакцию в коллекции лайков на новую
                const isStatusChanged = previousReactionStatus.updateLikeStatus(
                    { likeStatus: newLikeStatus },
                );

                // сохраняем
                if (isStatusChanged) {
                    await this.commentLikesCommandRepository.save(
                        previousReactionStatus,
                    );
                }

                // меняем реакцию в коллекции постов на новую
                const ifSwitchReactionSuccessfull =
                    await this.commentsCommandRepository.switchCommentReaction({
                        sentCommentId: commentId,
                        newStatus: newLikeStatus,
                    });

                if (!ifSwitchReactionSuccessfull) {
                    throw new DomainException({
                        code: DomainExceptionCode.PostNotFound,
                        message: `Post not found`,
                    });
                }
            }
        }

        // // реакция изменена удачно
        // // теперь обновляем последние три лайка в посте, вытягивая инфу про крайние три лайка из базы лайков
        // const refreshLastLikesstatus =
        //     await this.postLikesQueryRepository.getLatestLikesForPost(postId);
        //
        // // обновляем пост
        // post.updateNewestLikes(refreshLastLikesstatus);
        //
        // // сохраняем изменения в посте
        // await this.postsCommandRepository.save(post);
    }
}
