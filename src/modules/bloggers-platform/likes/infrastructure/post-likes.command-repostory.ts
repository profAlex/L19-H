import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
    PostLike,
    PostLikeDocument,
    PostLikeModelType,
} from '../domain/post-like.entity';
import { LikeStatus } from '../../../../core/enums/like-status.enum';
import { DataSource } from 'typeorm';
import { CounterDirection } from './comment-likes.command-repository';

function isLikeStatus(val: any): val is LikeStatus {
    return Object.values(LikeStatus).includes(val);
}

@Injectable()
export class PostLikesCommandRepository {
    constructor(
        @InjectModel(PostLike.name) private PostLikeModel: PostLikeModelType,
        private readonly dataSource: DataSource,
    ) {}

    async save(postLike: PostLikeDocument): Promise<void> {
        await postLike.save();
    }

    async findSinglePostLikeByPostIdAndUserId({
        postId,
        userId,
    }: {
        postId: string;
        userId: string;
    }): Promise<PostLikeDocument | null> {
        return this.PostLikeModel.findOne({
            postId,
            userId,
        });
    }

    async SQLgetLikeByCommentIdAndUserId(userId:string, postId:string): Promise<LikeStatus | null> {
        const query = `
            SELECT 
                pl.status AS "status"
            FROM post_likes pl 
                INNER JOIN posts p ON p.id = $1
                INNER JOIN blogs b ON b.id = p.blog_id
            WHERE 
                pl.post_id = $1 AND pl.user_id = $2
                AND p.deleted_at IS NULL
                AND b.deleted_at IS NULL;
        `;

        const [postLikeStatus] = await this.dataSource.query<{status:string}[]>(query, [postId, userId]);

        if (!postLikeStatus || !isLikeStatus(postLikeStatus.status)) {
            return null;
        }

        return postLikeStatus.status;
    }

    async SQLupdateLikeStatus(
        postId: string,
        userId: string,
        status: LikeStatus,
    ): Promise<void> {
        const query = `
            INSERT INTO post_likes (post_id, user_id, status)
            VALUES ($1, $2, $3)
            ON CONFLICT (post_id,
                user_id) DO UPDATE SET /*comment_id = EXCLUDED.comment_id,
                                       user_id    = EXCLUDED.user_id,*/
                                       status     = EXCLUDED.status;
        `;

        const queryParams = [postId, userId, status];

        // console.log("query formed successfully");

        await this.dataSource.query(query, queryParams);
    }


}
