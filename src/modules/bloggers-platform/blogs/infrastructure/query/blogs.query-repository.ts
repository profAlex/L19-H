import { PaginatedViewDto } from '../../../../../core/dto/base.paginated.view-dto';
import { BlogViewDto, SQLBlogViewDto } from '../../api/view-dto/blogs.view-dto';
import { Blog, BlogDocument, BlogModelType } from '../../domain/blog.entity';
// import {FilterQuery, ObjectId} from "mongoose";
// import { type FilterQuery } from 'mongoose';
import { GetBlogsQueryParams } from '../../api/input-dto/get-blogs-query-params.input-dto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SortDirection } from '../../../../../core/dto/base.query-params.input-dto';
import { DomainException } from '../../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../../core/exceptions/domain-exception-codes';
import { DataSource } from 'typeorm';

interface RawBlogData {
    id: string;
    name: string;
    description: string;
    website_url: string;
    created_at: string | Date;
    is_membership: boolean;
}

@Injectable()
export class BlogsQueryRepository {
    constructor(
        @InjectModel(Blog.name) private BlogModel: BlogModelType,
        private readonly dataSource: DataSource,
    ) {}

    async getBlogName(sentBlogId: string) {
        return this.BlogModel.findOne({ _id: sentBlogId, deletedAt: null })
            .select('name')
            .lean();
    }

    async getAllBlogs(
        query: GetBlogsQueryParams,
    ): Promise<PaginatedViewDto<BlogViewDto>> {
        const filter: Record<string, any> = {
            deletedAt: null,
        };

        // структура хранилища blogs
        //     _id: ObjectId;
        //     id: string;
        //     name: string;
        //     description: string;
        //     websiteUrl: string;
        //     createdAt: Date;
        //     isMembership: boolean;

        // структура GetBlogsQueryParams
        // sortBy = BlogsSortBy.CreatedAt;
        // searchNameTerm: string | null = null;
        // pageNumber: number = 1;
        // pageSize: number = 10;
        // sortDirection: SortDirection = SortDirection.Desc;

        // дальнейший блог if - это дополнительнве проверки в дополнение к дефолтным, назначаемым в классе GetBlogsQueryParams
        // 1) Если пользователь не ввел поисковое слово, query.searchNameTerm будет равен null.
        // В таком случае, если нет проверки if: программа попытается добавить в MongoDB условие
        // { name: { $regex: null } }. База либо вернет ошибку, либо (что хуже) попытается
        // найти документы, где имя буквально равно null.
        // С проверкой if(query.searchNameTerm) код просто не зайдет внутрь if, и массив $or
        // не создается. Запрос остается чистым.

        // 2) Защита от пустых строк
        // Иногда пользователи присылают ?searchNameTerm=. В этом случае в DTO может попасть
        // пустая строка "".
        // if (query.searchNameTerm) отфильтрует это (так как пустая строка — это falsy),
        // и база не будет нагружена бесполезным поиском по пустому регулярному выражению.

        const orConditions: any[] = [];

        if (query.searchNameTerm) {
            orConditions.push({
                name: { $regex: query.searchNameTerm, $options: 'i' },
            });
        }

        if (orConditions.length > 0) {
            filter.$or = orConditions;
        }
        //
        // if (query.searchNameTerm) {
        //     filter.$or = filter.$or || [];
        //     filter.$or.push({
        //         name: { $regex: query.searchNameTerm, $options: 'i' },
        //     });
        // }

        // const sortDirection =
        //     query.sortDirection === SortDirection.Asc ? 1 : -1;
        //
        // const sortByField = query.sortBy.toString(); // Жестко приводим к строке
        //
        // console.log('sortDirection field: ', query.sortDirection);
        // console.log('sortByField field: ', query.sortBy);
        //
        // const blogs = await this.BlogModel.find(filter)
        //     .sort({ [sortByField]: sortDirection }) // Используем чистую строку
        //     .skip(query.calculateSkip())
        //     .limit(query.pageSize);
        const blogs = await this.BlogModel.find(filter)
            .sort({
                [query.sortBy]:
                    query.sortDirection === SortDirection.Asc ? 1 : -1,
            })
            .skip(query.calculateSkip())
            .limit(query.pageSize);

        const totalCount = await this.BlogModel.countDocuments(filter);

        const items = blogs.map(BlogViewDto.mapToView);

        return PaginatedViewDto.mapToView<BlogViewDto>({
            items: items,
            page: query.pageNumber,
            size: query.pageSize,
            totalCount: totalCount,
        });
    }

    async SQLgetAllBlogs(
        query: GetBlogsQueryParams,
    ): Promise<PaginatedViewDto<SQLBlogViewDto>> {
        // вспомонательная переменная для накопления условиий WHERE фильтрации: со старта отсекаем soft-deleted сущности
        const whereConditions: string[] = [`blogs.deleted_at IS NULL`];

        // вспомогательная переменная для хранения части условий в WHERE, которые присоединяются через OR
        const orConditions: string[] = [];

        // эта переменная для формирования массива параметров, который подменяет $1, $2, $3
        const queryParams: any[] = [];

        // переменная для счетчика, для формирования правильной последовательной нумерации параметров $1, $2, $3
        let indexParamCounter: number = 1;

        // если в запрос передано условие поиска по имени (searchNameTerm) тогда его в качестве OR составляющей надо будет добваить в запрос WHERE
        if (query.searchNameTerm && query.searchNameTerm.trim() !== '') {
            orConditions.push(`name ILIKE $${indexParamCounter}`);
            queryParams.push(`%${query.searchNameTerm}%`);
            indexParamCounter += 1;
        }

        // добавляем все OR условия одним общим блоком в скобках ( ... OR ... ) к WHERE блоку
        if (orConditions.length > 0) {
            whereConditions.push(`(${orConditions.join(' OR ')})`); // хоть тут и один параметр максимум (searchNameTerm), но на случай если их количество изменится все равно делаем join
        }

        // соединяем предварительное условие
        const whereClause = whereConditions.join(' AND ');

        // определяем "белый список" разрешенных полей для сортировки
        // это защищает от SQL-инъекций, маппя camelCase из API в snake_case колонок БД
        // для каждого типа сущности тут будет свой набор
        const auxSortingMapper: Record<string, string> = {
            name: 'name',
            description: 'description',
            websiteUrl: 'website_url',
            createdAt: 'created_at',
            isMembership: 'is_membership',
        };

        // определяем имя колонки для ORDER BY. Если передан невалидный ключ — фоллбэк на 'created_at'
        const sortByColumn = auxSortingMapper[query.sortBy] || 'created_at';

        // определяем направление сортировки приводим к верхнему регистру и проверяем на ASC, иначе DESC
        const sortDirection =
            query.sortDirection && query.sortDirection.toUpperCase() === 'ASC'
                ? 'ASC'
                : 'DESC';

        // вычисляем смещение (сколько записей пропустить: (pageNumber - 1) * pageSize)
        const offset = query.calculateSkip();

        // количество элементов на странице
        const limit = query.pageSize;

        // формируем SQL-запрос для получения самих элементов
        const itemsQuery = `
            SELECT 
                id,
                name,
                description,
                website_url,
                created_at,
                is_membership
            FROM blogs
            WHERE ${whereClause}
            ORDER BY ${sortByColumn} ${sortDirection}
            LIMIT $${indexParamCounter}
            OFFSET $${indexParamCounter + 1}
        `;

        // SQL-запрос для получения общего количества записей (без LIMIT/OFFSET),
        // чтобы рассчитать общее количество страниц.
        // ::int принудительно приводит bigint из Postgres к обыкновенному number в JS
        const countQuery = `
            SELECT COUNT(*) ::int AS "totalCount"
            FROM blogs
            WHERE ${whereClause}
        `;

        // оба запроса можно запусить параллельно с помощью Promise.all
        const [blogsRows, countResult] = await Promise.all([
            this.dataSource.query<RawBlogData[]>(itemsQuery, [
                ...queryParams,
                limit,
                offset,
            ]),
            this.dataSource.query<{ totalCount: number }[]>(
                countQuery,
                queryParams,
            ),
        ]);

        // преобразуем сырые строки из базы (snake_case) в DTO для клиентов (camelCase) и в требуемой структуре
        const items = blogsRows.map(SQLBlogViewDto.mapFromDbRaw);
        const totalCount = countResult[0]?.totalCount ?? 0;

        return PaginatedViewDto.mapToView<SQLBlogViewDto>({
            items: items,
            page: query.pageNumber,
            size: query.pageSize,
            totalCount: totalCount,
        });
    }

    async getBlogByIdOrNotFoundFail(blogId: string): Promise<BlogViewDto> {
        const blog = await this.BlogModel.findOne({
            _id: blogId,
            $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
        }).lean();

        if (!blog) {
            // throw new NotFoundException('Blog not found');
            throw new DomainException({
                code: DomainExceptionCode.BlogNotFound,
                message: `Blog not found`,
            });
        }
        return BlogViewDto.mapToView(blog);
    }

    async SQLgetBlogById(blogId: string): Promise<SQLBlogViewDto | null> {

        console.log()
        const query = `
            SELECT 
                id,
                name,
                description,
                website_url,
                created_at,
                is_membership
            FROM public.blogs
            WHERE id = $1 AND deleted_at IS NULL;
        `;

        const [blogRow] = await this.dataSource.query<RawBlogData[]>(query, [
            blogId,
        ]);

        if (!blogRow) {
            return null;
        }

        return SQLBlogViewDto.mapFromDbRaw(blogRow);
    }

    async ifBlogExists(blogId: string): Promise<boolean> {
        const count = await this.BlogModel.countDocuments({
            _id: blogId,
            deletedAt: null,
        });

        return count > 0;
    }

    async SQLifBlogExists(blogId: string): Promise<boolean> {
        const query = ` 
            SELECT EXISTS (
                SELECT 1
                FROM public.blogs
                WHERE id = $1 AND deleted_at IS NULL
            ) as exists;
        `;

        const [resultRow] = await this.dataSource.query<{ exists: boolean }[]>(
            query,
            [blogId],
        );

        // если вдруг по какой-то причине драйвер вернет пустой массив, тогда просто nest выдаст 500
        // Boolean(...): Гарантирует, что метод всегда вернет строго true или false (boolean), даже если СУБД вернет 1/0 или "true"/"false"
        return Boolean(resultRow?.exists);
    }
}
