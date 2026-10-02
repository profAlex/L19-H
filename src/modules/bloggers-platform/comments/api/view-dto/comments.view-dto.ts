import { LikeStatus } from '../../../../../core/enums/like-status.enum';
import { Comment } from '../../domain/comment.entity';
import { FlattenMaps, Types } from 'mongoose';
import { SQLcommentQueryRawDto } from '../../infrastructure/query/comments.query-repository';

// export type CommentStorageModel = {
//     _id: ObjectId;
//     id: string;
//     relatedPostId: string;
//     content: string;
//     commentatorInfo: CommentatorInfo;
//     createdAt: Date;
//     likesInfo: LikesInfoViewModel;
// };
//
// export type CommentatorInfo = {
//     userId: string;
//     userLogin: string;
// };
//
// export type LikesInfo = {
//     likesCount: number;
//     dislikesCount: number;
//     myStatus: LikeStatus;
// }

// export enum LikeStatus {
//     None = 'None',
//     Like = 'Like',
//     Dislike = 'Dislike'
// }

// export class CommentViewDto {
//     id: string;
//     content: string;
//     commentatorInfo: {
//         userId: string,
//         userLogin: string,
//     };
//     createdAt: string;
//     likesInfo: {
//         likesCount: number,
//         dislikesCount: number,
//         myStatus: LikeStatus
//     }
//
//     static mapToView(comment: FlattenMaps<CommentDocument> & { _id: Types.ObjectId }): CommentViewDto {
//         const newComment = new CommentViewDto();
//
//         newComment.id = comment._id.toString();
//         newComment.content = comment.content;
//         // вложенные объекты (likesInfo, commentatorInfo, extendedLikesInfo) всегда должны создаваться «целиком» через фигурные скобки { ... }.
//         // или создавать их при инициализации нового инстанса, выше объявлении должно быть написано так:
//         // commentatorInfo = {
//         //         userId: '',
//         //         userLogin: '',
//         //     };
//         newComment.commentatorInfo = {
//             userId: comment.commentatorInfo.userId,
//             userLogin: comment.commentatorInfo.userLogin,
//         };
//         newComment.createdAt = new Date(comment.createdAt).toISOString();
//         newComment.likesInfo = {
//             likesCount: comment.likesInfo.likesCount,
//             dislikesCount: comment.likesInfo.dislikesCount,
//             myStatus: comment.likesInfo.myStatus,
//         }
//
//         return newComment;
//     };
// }

export class CommentViewDto {
    id: string;
    content: string;
    commentatorInfo: {
        userId: string;
        userLogin: string;
    };
    createdAt: string;
    likesInfo: {
        likesCount: number;
        dislikesCount: number;
        myStatus: LikeStatus;
    };

    constructor(
        comment: Comment & { _id: Types.ObjectId },
        myStatus?: LikeStatus,
    ) {
        this.id = comment.id || comment._id?.toString() || '';
        this.content = comment.content;

        // Вложенные объекты инициализируются целиком внутри конструктора
        this.commentatorInfo = {
            userId: comment.commentatorInfo.userId,
            userLogin: comment.commentatorInfo.userLogin,
        };

        // Железно переводим в ISO строку для авто-тестов
        this.createdAt =
            comment.createdAt instanceof Date
                ? comment.createdAt.toISOString()
                : new Date(comment.createdAt).toISOString();

        this.likesInfo = {
            likesCount: comment.likesInfo.likesCount,
            dislikesCount: comment.likesInfo.dislikesCount,
            myStatus: myStatus ?? comment.likesInfo.myStatus ?? LikeStatus.None,
        };
    }

    static mapToView(
        comment: Comment & { _id: Types.ObjectId },
        myStatus?: LikeStatus,
    ): CommentViewDto {
        return new CommentViewDto(comment, myStatus);
    }


}


// вспомогательная функция для конвертации значения в тип enum LikeStatus
function isLikeStatus(value: any): value is LikeStatus {
    return Object.values(LikeStatus).includes(value);
}


export class SQLCommentViewDto {
    id: string;
    content: string;
    commentatorInfo: {
        userId: string;
        userLogin: string;
    };
    createdAt: string;
    likesInfo: {
        likesCount: number;
        dislikesCount: number;
        myStatus: LikeStatus;
    };

    static mapSQLRowToView(
        raw: SQLcommentQueryRawDto
    ): CommentViewDto {
        const dto = new SQLCommentViewDto();

        dto.id = raw.id;
        dto.content = raw.content;
        dto.commentatorInfo = {
            userId: raw.userId,
            userLogin: raw.userLogin ?? 'Unknown User',
        };

        // пытаемся сформировать дату из пришедшего значения string или Date
        const parsedDate = new Date(raw.createdAt);

        // если полученное значение .getTime() это не number то это несогласованное состояние данных, по хорошему это надо править
        if (isNaN(parsedDate.getTime())) {
            throw new Error(`Data integrity issue: Invalid createdAt timestamp for comment ${raw.id}`);
        }

        dto.createdAt = parsedDate.toISOString();
        dto.likesInfo = {
            likesCount: Number(raw.likesCount ?? 0),
            dislikesCount: Number(raw.dislikesCount ?? 0),
            myStatus: isLikeStatus(raw.myStatus)
                ? raw.myStatus
                : LikeStatus.None
        };

        return dto;
    }
}