import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
    CommentLike,
    CommentLikeDocument,
    CommentLikeModelType,
} from '../domain/comment-like.entity';
import { PostLikeDocument } from '../domain/post-like.entity';
import { LikeStatus } from '../../../../core/enums/like-status.enum';
import { DataSource } from 'typeorm';

function isLikeStatus(val: any): val is LikeStatus {
    return Object.values(LikeStatus).includes(val);
}

export type CounterDirection = 1 | -1;


@Injectable()
export class CommentLikesCommandRepository {
    constructor(
        @InjectModel(CommentLike.name)
        private CommentLikeModel: CommentLikeModelType,
        private readonly dataSource: DataSource,
    ) {}

    async save(commentLike: CommentLikeDocument): Promise<void> {
        await commentLike.save();
    }

    async findSingleCommentLikeByCommentIdAndUserId({
        commentId,
        userId,
    }: {
        commentId: string;
        userId: string;
    }): Promise<CommentLikeDocument | null> {
        return this.CommentLikeModel.findOne({
            commentId,
            userId,
        });
    }

    async SQLupdateLikeStatus(
        commentId: string,
        userId: string,
        status: LikeStatus,
    ): Promise<void> {
        const query = `
            INSERT INTO comment_likes (comment_id, user_id, status)
            VALUES ($1, $2, $3)
            ON CONFLICT (comment_id,
                user_id) DO UPDATE SET comment_id = EXCLUDED.comment_id,
                                       user_id    = EXCLUDED.user_id,
                                       status     = EXCLUDED.status;
        `;

        const queryParams = [commentId, userId, status];

        // console.log("query formed successfully");

        await this.dataSource.query(query, queryParams);
    }


    async SQLgetLikeByCommentIdAndUserId({
        commentId,
        userId,
    }: {
        commentId: string;
        userId: string;
    }): Promise<LikeStatus | null> {
        const query = `
            SELECT status
            FROM comment_likes cl
                     INNER JOIN comments c ON (cl.comment_id = c.id)
                     INNER JOIN posts p ON (c.post_id = p.id)
                     INNER JOIN blogs b ON (p.blog_id = b.id)
            WHERE cl.comment_id = $1
              AND cl.user_id = $2
              AND c.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND b.deleted_at IS NULL;
        `;

        const [commentLikeStatus] =
            await this.dataSource.query<{ status: string }[]>(query, [commentId, userId]);

        if (!commentLikeStatus || !isLikeStatus(commentLikeStatus.status)) {
            return null;
        }

        return commentLikeStatus.status;
    }



}
