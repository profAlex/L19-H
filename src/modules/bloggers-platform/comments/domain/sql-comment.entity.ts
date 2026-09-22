

export interface SQLCreateCommentDomainDto {
    content: string;
    postId: string;
    userId: string;
}

export interface SQLUpdateCommentInputDto {
    content: string;
}

export class SQLComment {
    id: string;
    content: string;
    postId: string;
    userId: string;
    likesCount: number;
    dislikesCount: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;

    private constructor() {}

    static createInstance(dto: SQLCreateCommentDomainDto): SQLComment {
        const comment = new SQLComment();

        comment.content = dto.content;
        comment.postId = dto.postId;
        comment.userId = dto.userId;
        comment.likesCount = 0;
        comment.dislikesCount = 0;
        comment.createdAt = new Date();
        comment.updatedAt = new Date();
        comment.deletedAt = null;

        return comment;
    }


    static reconstructInstance(raw: any): SQLComment {
        const comment = new SQLComment();

        comment.id = raw.id;
        comment.content = raw.content;
        comment.postId = raw.post_id;
        comment.userId = raw.user_id;
        comment.likesCount = Number(raw.likes_count ?? raw.likesCount ?? 0);
        comment.dislikesCount = Number(raw.dislikes_count ?? raw.dislikesCount ?? 0);

        // Валидация дат и защита от new Date(null)
        comment.createdAt = raw.created_at ? new Date(raw.created_at) : new Date();
        comment.updatedAt = raw.updated_at ? new Date(raw.updated_at) : new Date();
        comment.deletedAt = raw.deleted_at ? new Date(raw.deleted_at) : null;

        return comment;
    }


    makeDeleted(): void {
        if (this.deletedAt !== null) {
            return;
        }
        this.deletedAt = new Date();
        this.updatedAt = new Date();
    }

    updateComment(dto: SQLUpdateCommentInputDto): boolean {
        if (this.content === dto.content) {
            return false;
        }

        this.content = dto.content;
        this.updatedAt = new Date();
        return true;
    }
}