import { InjectModel } from '@nestjs/mongoose';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
    Comment,
    CommentDocument,
    CommentModelType,
} from '../domain/comment.entity';
import { CommentViewDto } from '../api/view-dto/comments.view-dto';
import { GetCommentsQueryParams } from '../api/input-dto/get-comments-query-params.input-dto';
import { PaginatedViewDto } from '../../../../core/dto/base.paginated.view-dto';
import { SortDirection } from '../../../../core/dto/base.query-params.input-dto';
import { CreateCommentApiInputDto } from '../api/input-dto/create-comment.api.input-dto';
import { LikeStatus } from '../../../../core/enums/like-status.enum';
import { DataSource } from 'typeorm';
import { CounterDirection } from '../../likes/infrastructure/comment-likes.command-repository';
import { SQLComment } from '../domain/sql-comment.entity';

interface SQLCommentViewDto {
    id: string;
    content: string;
    postId: string;
    userId: string;
    likesCount: number;
    dislikesCount: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

@Injectable()
export class CommentsCommandRepository {
    constructor(
        @InjectModel(Comment.name) private CommentModel: CommentModelType,
        private readonly dataSource: DataSource,
    ) {}

    async save(comment: CommentDocument): Promise<void> {
        await comment.save();
    }

    async SQLsaveUpdate(comment: SQLComment): Promise<void> {
        const query = `
            UPDATE comments
            SET content    = $2,
                updated_at = $3,
                deleted_at = $4
            WHERE id = $1;
        `;
        const queryParams = [
            comment.id,
            comment.content,
            comment.updatedAt,
            comment.deletedAt,
        ];

        await this.dataSource.query(query, queryParams);
    }

    async SQLsaveCreate(comment: SQLComment): Promise<string> {
        const query = `
            INSERT INTO comments (content, post_id, user_id, likes_count, dislikes_count, created_at, updated_at,
                                  deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id;
        `;

        const queryParams = [
            comment.content,
            comment.postId,
            comment.userId,
            comment.likesCount,
            comment.dislikesCount,
            comment.createdAt,
            comment.updatedAt,
            comment.deletedAt,
        ];

        const [result] = await this.dataSource.query<{id:string}[]>(query, queryParams);

        return result.id;
    }


    async SQLifCommentExists(commentId: string): Promise<boolean> {
        const query = `
            SELECT EXISTS (SELECT 1
                           FROM comments c
                                    INNER JOIN posts p ON c.post_id = p.id
                                    INNER JOIN blogs b ON (p.blog_id = b.id)

                           WHERE c.id = $1
                             AND c.deleted_at IS NULL
                             AND p.deleted_at IS NULL
                             AND b.deleted_at IS NULL) AS "exists";
        `;

        const [queryRow] = await this.dataSource.query<{ exists: boolean }[]>(
            query,
            [commentId],
        );

        return queryRow?.exists ?? false; // на случай если queryRow вернется как undefined по каким-то причинам
    }

    async SQLchangeCommentLikesCounter(
        commentId: string,
        direction: CounterDirection,
    ): Promise<void> {
        const query = `
            UPDATE public.comments
            SET likes_count = GREATEST(0, likes_count + $2)
            WHERE id = $1
              AND deleted_at IS NULL;
        `;

        await this.dataSource.query(query, [commentId, direction]);
    }

    async SQLchangeCommentDislikesCounter(
        commentId: string,
        direction: CounterDirection,
    ): Promise<void> {
        const query = `
            UPDATE public.comments
            SET dislikes_count = GREATEST(0, dislikes_count + $2)
            WHERE id = $1
              AND deleted_at IS NULL;
        `;

        await this.dataSource.query(query, [commentId, direction]);
    }

    async SQLswitchToLikeCommentCounter(commentId: string): Promise<void> {
        const query = `
            UPDATE public.comments
            SET dislikes_count = GREATEST(0, dislikes_count - 1),
                likes_count    = GREATEST(0, likes_count + 1)
            WHERE id = $1
              AND deleted_at IS NULL;
        `;

        await this.dataSource.query(query, [commentId]);
    }

    async SQLswitchToDislikeCommentCounter(commentId: string): Promise<void> {
        const query = `
            UPDATE public.comments
            SET likes_count    = GREATEST(0, likes_count - 1),
                dislikes_count = GREATEST(0, dislikes_count + 1)
            WHERE id = $1
              AND deleted_at IS NULL;
        `;

        await this.dataSource.query(query, [commentId]);
    }

    async getCommentById(id: string): Promise<CommentDocument | null> {
        return this.CommentModel.findOne({
            _id: id,
            deletedAt: null,
        }).exec();

        // Без .exec() Mongoose возвращает так называемый Query (объект-обещание), который ведет себя как Promise,
        // но им не является. Вызов .exec() превращает его в полноценный нативный JavaScript Promise.
        // Это дает более чистые и понятные стек-трейсы ошибок (stack traces), если база данных начнет сбоить,
        // и исключает странные баги с типизацией в некоторых версиях TypeScript.
    }

    async SQLfindCommentById(commentId: string): Promise<SQLComment | null> {
        const query = `
            SELECT c.id,
                   c.content,
                   c.post_id        AS "postId",
                   c.user_id        AS "userId",
                   c.likes_count    AS "likesCount",
                   c.dislikes_count AS "dislikesCount",
                   c.created_at     AS "createdAt",
                   c.updated_at     AS "updatedAt",
                   c.deleted_at     AS "deletedAt"
            FROM public.comments c
                     INNER JOIN public.posts p ON c.post_id = p.id
                     INNER JOIN public.blogs b ON p.blog_id = b.id
            WHERE c.id = $1
              AND c.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND b.deleted_at IS NULL;
        `;

        const [commentRow] = await this.dataSource.query<SQLCommentViewDto[]>(
            query,
            [commentId],
        );

        if (!commentRow) {
            return null;
        }

        return SQLComment.reconstructInstance(commentRow);
    }

    // методы для переключения счетчика лайков в комментарии
    async addCommentReaction({
        sentCommentId,
        newStatus,
    }: {
        sentCommentId: string;
        newStatus: LikeStatus;
    }): Promise<boolean> {
        try {
            const updateQuery =
                newStatus === LikeStatus.Like
                    ? { 'likesInfo.likesCount': 1 }
                    : { 'likesInfo.dislikesCount': 1 };

            // атомарный апдейт для избегания состояния гонки
            const result = await this.CommentModel.updateOne(
                { _id: sentCommentId },
                { $inc: updateQuery },
            );

            // если matchedCount === 0, значит поста с таким ID уже нет в базе
            if (result.matchedCount === 0) {
                // обработка на тот случай, если пост был удален пока мы занимались вычислениями или сеть залагала

                console.error(
                    `Couldn't find comment with id: ${sentCommentId} inside CommentsCommandRepository.addCommentReaction`,
                );

                return false;
            }

            return true;
        } catch (error) {
            // а эта обработка общих ошибок инфраструктуры, то есть если именно проблема какая-то случилось при запросе к базы, может быть любой сбой. но это серьезная неисправность
            console.error(
                ` Error inside CommentsCommandRepository.addCommentReaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
            throw new InternalServerErrorException('Internal server error');
        }
    }

    async nullifyCommentReaction({
        sentCommentId,
        oldStatus,
    }: {
        sentCommentId: string;
        oldStatus: LikeStatus;
    }): Promise<boolean> {
        try {
            const fieldToDecrement =
                oldStatus === LikeStatus.Like
                    ? 'likesInfo.likesCount'
                    : 'likesInfo.dislikesCount';

            // создаем фильтр: ищем по ID И проверяем, что в поле больше 0
            const filter: any = {
                _id: sentCommentId,
                [fieldToDecrement]: { $gt: 0 }, // Защита от ухода в минус
            };

            // выполняем атомарное уменьшение счетчика
            const result = await this.CommentModel.updateOne(filter, {
                $inc: { [fieldToDecrement]: -1 },
            });

            if (result.matchedCount === 0) {
                // обработка на тот случай, если пост был удален пока мы занимались вычислениями или сеть залагала
                console.error(
                    `Couldn't find comment with id: ${sentCommentId} inside CommentsCommandRepository.nullifyPostReaction`,
                );

                return false;
            }

            return true;
        } catch (error) {
            // а эта обработка общих ошибок инфраструктуры, то есть если именно проблема какая-то случилось при запросе к базы, может быть любой сбой. но это серьезная неисправность
            console.error(
                `Error inside CommentsCommandRepository.nullifyPostReaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );

            throw new InternalServerErrorException('Internal server error');
        }
    }

    async switchCommentReaction({
        sentCommentId,
        newStatus,
    }: {
        sentCommentId: string;
        newStatus: LikeStatus;
    }): Promise<boolean> {
        try {
            let result;
            // Определяем, что прибавляем, а что отнимаем
            const isEnablingLike = newStatus === LikeStatus.Like;

            // если выставляем лайк меняя дизлайк
            if (isEnablingLike) {
                result = await this.CommentModel.updateOne(
                    {
                        _id: sentCommentId,
                    },
                    {
                        $inc: {
                            'likesInfo.likesCount': 1,
                            'likesInfo.dislikesCount': -1,
                        },
                    },
                );
            } else {
                // если выставляем дизлайк, меняя лайк
                result = await this.CommentModel.updateOne(
                    {
                        _id: sentCommentId,
                    },
                    {
                        $inc: {
                            'likesInfo.likesCount': -1,
                            'likesInfo.dislikesCount': 1,
                        },
                    },
                );
            }

            // обработка на тот случай, если пост был удален пока мы занимались вычислениями или сеть залагала
            if (result.matchedCount === 0) {
                console.error(
                    `Couldn't find comment with id: ${sentCommentId} inside CommentsCommandRepository.switchCommentReaction`,
                );

                return false;
            }

            return true;
        } catch (error) {
            // а эта обработка общих ошибок инфраструктуры, то есть если именно проблема какая-то случилось при запросе к базы, может быть любой сбой. но это серьезная неисправность
            console.error(
                `Error saving comment reaction inside CommentsCommandRepository.switchCommentReaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );

            throw new InternalServerErrorException('Internal server error');
        }
    }
}
