import { Injectable } from '@angular/core';
import { AngularFireDatabase, AngularFireList } from '@angular/fire/compat/database';
import { Observable, from, forkJoin, of } from 'rxjs';
import { map, switchMap, mergeMap, toArray, take } from 'rxjs/operators';
import { IPost } from '../../models/post.model';
import { BaseService } from '../base.service';
import { CommentService } from '../comment/comment.service';
import { IComment } from '../../models/comment.model';

@Injectable({
  providedIn: 'root'
})
export class PostService extends BaseService{

  private dbPath = '/posts';
  postRef: AngularFireList<IPost>;

  constructor(
    private db: AngularFireDatabase,
    private commentService: CommentService
  ) {
    super();
    this.postRef = db.list(this.dbPath);
  }

    // Lấy tất cả danh mục bài viết
    getAllPosts(): Observable<IPost[]> {
      return this.postRef.snapshotChanges().pipe(
        map(changes =>
          changes.map(c => ({
            ...(c.payload.val() as IPost),
            key: c.payload.key as string
          }))
        )
      );
    }

      // Lấy một danh mục bài viết cụ thể dựa trên key
  getPost(key: string): Observable<IPost | null> {
    return this.db.object(`${this.dbPath}/${key}`).valueChanges().pipe(
      map(data => {
        if (data) {
          return { ...(data as IPost), key };
        }
        return null;
      })
    );
  }

  // lấy một bài viết theo slug
  getPostBySlug(slug: string): Observable<IPost | null> {
    return this.db.list<IPost>('/posts', ref => ref.orderByChild('slug').equalTo(slug))
      .snapshotChanges()
      .pipe(
        map(changes => {
          if (changes.length > 0) {
            const change = changes[0];
            const data = change.payload.val() as IPost;
            const key = change.payload.key ?? undefined;  // Chuyển null thành undefined
            return { ...data, key };
          }
          return null;
        })
      );
  }

  // Hàm tạo slug duy nhất
  generateUniqueSlug(title: string, postKey?: string): Observable<string> {
    const baseSlug = this.createSlug(title);
    return this.getAllPosts().pipe(
      take(1), // Chỉ lấy giá trị đầu tiên và kết thúc Observable
      map(posts => {
        const slugs = posts
          .filter(cat => cat.key !== postKey)
          .map(cat => cat.slug);
        let uniqueSlug = baseSlug;
        let counter = 1;
        while (slugs.includes(uniqueSlug)) {
          uniqueSlug = `${baseSlug}-${counter}`;
          counter++;
        }
        return uniqueSlug;
      })
    );
  }

  create(post: Omit<IPost, 'key' | 'slug' | 'created_at' | 'updated_at'> & { imageFile?: File, albumFiles?: File[] }): Observable<IPost> {
    return this.generateUniqueSlug(post.title).pipe(
      switchMap(slug => {
        const now = new Date().toISOString();
        const newpost: Omit<IPost, 'key'> = {
          ...post,
          slug,
          created_at: now,
          updated_at: now,
          image: null,
          album: null
        };



        const imageUpload = post.imageFile
          ? this.uploadImage(post.imageFile)
          : of(null);
        const albumUpload = post.albumFiles && post.albumFiles.length > 0
          ? this.uploadAlbum(post.albumFiles)
          : of(null);

        return forkJoin({
          image: imageUpload,
          album: albumUpload
        }).pipe(
          switchMap(({ image, album }) => {
            const finalpost: IPost = {
              ...newpost,
              image,
              album
            };

            return from(this.postRef.push(finalpost)).pipe(
              map(ref => ({
                ...finalpost,
                key: ref.key as string
              }))
            );
          })
        );
      })
    );
  }




  update(key: string, post: Partial<IPost> & { imageFile?: File, albumFiles?: File[] }): Observable<IPost> {
    return this.generateUniqueSlug(post.title || '', key).pipe(
      switchMap(slug => {
        const now = new Date().toISOString();
        const { imageFile, albumFiles, ...updateData } = post;
        updateData.slug = slug;
        updateData.updated_at = now;

        const imageUpload = imageFile
          ? this.uploadImage(imageFile)
          : of(updateData.image);
        const albumUpload = albumFiles && albumFiles.length > 0
          ? this.uploadAlbum(albumFiles)
          : of(updateData.album);

        return forkJoin({
          image: imageUpload,
          album: albumUpload
        }).pipe(
          switchMap(({ image, album }) => {
            const finalUpdateData: Partial<IPost> = {
              ...updateData,
              image,
              album
            };

            return from(this.postRef.update(key, finalUpdateData)).pipe(
              switchMap(() => this.getPost(key)),
              map(updatedCategory => {
                if (!updatedCategory) {
                  throw new Error('Failed to retrieve updated category');
                }
                return updatedCategory;
              })
            );
          })
        );
      })
    );
  }
   // Xóa một expense dựa trên key
   delete(key: string): Observable<void> {
    return from(this.db.object(`${this.dbPath}/${key}`).remove());
  }

  getPostsByCategoryId(categoryId: string): Observable<IPost[]> {
    return this.db.list<IPost>('/posts', ref =>
      ref.orderByChild('post_category_id').equalTo(categoryId)
    ).snapshotChanges().pipe(
      map(changes =>
        changes.map(c => ({ key: c.payload.key!, ...c.payload.val()! }))
      )
    );
  }

  //comment
  getPostWithComments(postId: string): Observable<IPost & { comments: IComment[] }> {
    return this.getPost(postId).pipe(
      switchMap(post => {
        if (post === null) {
          throw new Error('Post not found');
        }
        return this.commentService.getCommentsByPostId(postId).pipe(
          map(comments => ({
            ...post,
            post_category_id: post.post_category_id || [],
            title: post.title || '',
            slug: post.slug || '',
            publish: post.publish || false,
            created_at: post.created_at || '',
            updated_at: post.updated_at || '',
            comments
          }))
        );
      })
    );
  }

  updateCommentCount(postId: string, count: number): Observable<void> {
    return from(this.db.object(`${this.dbPath}/${postId}`).update({ comment_count: count }));
  }
}
