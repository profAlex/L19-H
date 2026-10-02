import {
    Comment,
    CommentDocument,
    CommentModelType,
} from '../../domain/comment.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
    CommentViewDto,
    SQLCommentViewDto,
} from '../../api/view-dto/comments.view-dto';
import { GetCommentsQueryParams } from '../../api/input-dto/get-comments-query-params.input-dto';
import { PaginatedViewDto } from '../../../../../core/dto/base.paginated.view-dto';
import { SortDirection } from '../../../../../core/dto/base.query-params.input-dto';
import { FlattenMaps, Types } from 'mongoose';
import { LikeStatus } from '../../../../../core/enums/like-status.enum';
import { CommentLikesQueryRepository } from '../../../likes/infrastructure/query/comment-likes.query-repository';
import { DataSource } from 'typeorm';
import { PostViewDto } from '../../../posts/api/view-dto/posts.view-dto';

export interface SQLcommentQueryRawDto {
    id: string;
    content: string;
    userId: string;
    userLogin: string | null; // Защищает от NULL
    createdAt: Date | string; // Защищает от объекта Date
    likesCount: number | string; // Защищает от строк из COUNT()
    dislikesCount: number | string; // Защищает от строк из COUNT()
    myStatus: string;
}

@Injectable()
export class CommentsQueryRepository {
    constructor(
        @InjectModel(Comment.name) private CommentModel: CommentModelType,
        private readonly commentLikesQueryRepository: CommentLikesQueryRepository,
        private readonly dataSource: DataSource,
    ) {}

    async getCommentById(
        commentId: string,
        userId?: string | undefined,
    ): Promise<SQLCommentViewDto | null> {
        const comment = await this.CommentModel.findOne({
            _id: commentId,
            deletedAt: null,
        }).lean<FlattenMaps<CommentDocument> & { _id: Types.ObjectId }>();

        if (!comment) {
            return null;
        }

        let userReaction: LikeStatus = LikeStatus.None;
        if (userId) {
            userReaction =
                await this.commentLikesQueryRepository.getReactionForComment(
                    commentId,
                    userId,
                );
        }

        return CommentViewDto.mapToView(comment, userReaction);
    }

    async SQLgetCommentById(
        commentId: string,
        userId?: string | undefined,
    ): Promise<CommentViewDto | null> {
        // {
        //     "id": "string",
        //     "content": "string",
        //     "commentatorInfo": {
        //         "userId": "string",
        //         "userLogin": "string"
        //     },
        //     "createdAt": "2026-09-25T19:08:52.356Z",
        //     "likesInfo": {
        //         "likesCount": 0,
        //         "dislikesCount": 0,
        //         "myStatus": "None"
        //     }
        // }

        const commentInfoQuery = `
            SELECT c.id,
                   c.content,
                   c.user_id                  AS "userId",
                   u.login                    AS "userLogin",
                   c.created_at               AS "createdAt",
                   c.likes_count              AS "likesCount",
                   c.dislikes_count           AS "dislikesCount",
                   COALESCE(l.status, 'None') AS "myStatus"
            FROM public.comments c
                     -- Пользователя и лайки соединяем через LEFT JOIN (юзер может быть удален, а лайка может не быть)
                     LEFT JOIN public.users u ON c.user_id = u.id AND u.deleted_at IS NULL
                     LEFT JOIN public.comment_likes l ON c.id = l.comment_id AND l.user_id = $1

                -- Пост и Блог проверяем строго через INNER JOIN 
                     INNER JOIN public.posts p ON c.post_id = p.id
                     INNER JOIN public.blogs b ON p.blog_id = b.id
            WHERE c.id = $2
              -- Вся цепочка родительских объектов должна быть не удалена, чтобы гарантировать lazy cascade soft deletion
              AND c.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND b.deleted_at IS NULL;
        `;

        const [commentRow] = await this.dataSource.query<
            SQLcommentQueryRawDto[]
        >(commentInfoQuery, [userId ?? null, commentId]);

        if (!commentRow) {
            return null;
        }

        return SQLCommentViewDto.mapSQLRowToView(commentRow);
    }

    async getCommentsByPostId({
        postId,
        query,
        userId,
    }: {
        postId: string;
        query: GetCommentsQueryParams;
        userId?: string | undefined;
    }): Promise<PaginatedViewDto<CommentViewDto>> {
        // 1. ЖЕСТКАЯ ЗАЩИТА: Проверяем, что sortBy существует и это не пустая строка
        const sortByField =
            query.sortBy && query.sortBy.trim() !== ''
                ? query.sortBy
                : 'createdAt';

        // 2. Страхуем направление сортировки
        const sortDirectionMultiplier =
            query.sortDirection === SortDirection.Asc ? 1 : -1;

        // 3. Страхуем пагинацию (на случай, если платформа пришлет NaN или 0)
        const pageSize =
            query.pageSize && query.pageSize > 0 ? query.pageSize : 10;
        const pageNumber =
            query.pageNumber && query.pageNumber > 0 ? query.pageNumber : 1;

        // Используем метод класса, но если он выдаст NaN/0, берем безопасный расчет
        const skip =
            query.calculateSkip() >= 0
                ? query.calculateSkip()
                : (pageNumber - 1) * pageSize;

        const sentPostId = postId;
        const sentUserId = userId;

        const filter = {
            deletedAt: null,
            ...(sentPostId ? { relatedPostId: sentPostId } : {}),
        };

        const [commentsList, totalCount] = await Promise.all([
            this.CommentModel.find(filter)
                // 4. Передаем гарантированно чистые и валидные данные в sort
                .sort({
                    [sortByField]: sortDirectionMultiplier,
                })
                .skip(skip)
                .limit(pageSize)
                .lean<
                    (FlattenMaps<CommentDocument> & { _id: Types.ObjectId })[]
                >(),

            this.CommentModel.countDocuments(filter),
        ]);

        const likesMap = new Map<string, LikeStatus>(); // Ключ: postId, Значение: likeStatus

        if (sentUserId && commentsList.length > 0) {
            const commentIdsList = commentsList.map((comment) =>
                comment._id.toString(),
            );

            const userReactions =
                await this.commentLikesQueryRepository.getReactionListForComments(
                    commentIdsList,
                    sentUserId,
                );

            userReactions.forEach((reaction) => {
                likesMap.set(
                    reaction.commentId.toString(),
                    reaction.likeStatus,
                );
            });
        }

        return PaginatedViewDto.mapToView<CommentViewDto>({
            items: commentsList.map((item) => {
                const commentIdStr = item._id.toString();
                const myStatus = likesMap.get(commentIdStr) || LikeStatus.None;
                return CommentViewDto.mapToView(item, myStatus);
            }),
            page: pageNumber,
            size: pageSize,
            totalCount: totalCount,
        });
    }

    async SQLgetCommentsByPostId({
        postId,
        query,
        userId,
    }: {
        postId: string;
        query: GetCommentsQueryParams;
        userId?: string | undefined;
    }): Promise<PaginatedViewDto<CommentViewDto>> {
        // ITEMS VIEW STRUCTURE
        /*
        {
            "pagesCount": 0,
            "page": 0,
            "pageSize": 0,
            "totalCount": 0,
            "items": [
                {
                    "id": "string",
                    "content": "string",
                    "commentatorInfo": {
                        "userId": "string",
                        "userLogin": "string"
                    },
                    "createdAt": "2026-10-01T20:37:02.725Z",
                    "likesInfo": {
                        "likesCount": 0,
                        "dislikesCount": 0,
                        "myStatus": "None"
                    }
                }
            ]
        }
        */

        const { sortBy, sortDirection, pageNumber, pageSize } = query;

        const sortingMap: Record<string, string> = {
            id: 'c.id',
            content: 'c.content',
            createdAt: 'c.created_at',
        };

        const sortingClause = sortingMap[sortBy] || 'c.created_at';
        const directionClause =
            sortDirection?.trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const limit = pageSize;
        const offset = query.calculateSkip();

        const commentInfoQuery = `
            SELECT c.id,
                   c.content,
                   c.user_id                   AS "userId",
                   u.login                     AS "userLogin",
                   c.created_at                AS "createdAt",
                   c.likes_count               AS "likesCount",
                   c.dislikes_count            AS "dislikesCount",
                   COALESCE(cl.status, 'None') AS "myStatus"
            FROM comments c
                     LEFT JOIN users u ON u.id = c.user_id
                     LEFT JOIN comment_likes cl ON c.id = cl.comment_id AND cl.user_id = $1
                     INNER JOIN public.posts p ON p.id = c.post_id
                     INNER JOIN public.blogs b ON b.id = p.blog_id
            WHERE c.post_id = $2
              AND c.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND b.deleted_at IS NULL
            ORDER BY ${sortingClause} ${directionClause}
            LIMIT $3 OFFSET $4;
        `;

        const countQuery = `
            SELECT COUNT(*)::int AS "totalCount"
            FROM public.comments c
                 INNER JOIN public.posts p ON p.id = c.post_id
                 INNER JOIN public.blogs b ON b.id = p.blog_id
            WHERE c.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND b.deleted_at IS NULL
              AND c.post_id = $1;
        `;

        const [commentRows, countResult] = await Promise.all([
            this.dataSource.query<SQLcommentQueryRawDto[]>(commentInfoQuery, [
                userId ?? null,
                postId,
                limit,
                offset,
            ]),
            this.dataSource.query<{ totalCount: number }[]>(countQuery, [
                postId,
            ]),
        ]);

        const totalCount = countResult[0]?.totalCount ?? 0;

        // сразу возвращаем пустой результат и не делаем 2-й запрос если постов нет
        if (!commentRows.length) {
            return PaginatedViewDto.mapToView<SQLCommentViewDto>({
                items: [],
                page: pageNumber,
                size: pageSize,
                totalCount: totalCount,
            });
        }

        return PaginatedViewDto.mapToView<SQLCommentViewDto>({
            items: commentRows.map((comment) =>
                SQLCommentViewDto.mapSQLRowToView(comment),
            ),
            page: pageNumber,
            size: pageSize,
            totalCount: totalCount,
        });
    }
}
