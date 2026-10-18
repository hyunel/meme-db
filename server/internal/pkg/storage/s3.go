package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/hyunel/MemeDB/internal/config"
)

type s3Bucket struct {
	client *s3.Client
	name   string
}

func newS3Bucket(cfg config.S3StorageConfig) *s3Bucket {
	client := s3.New(s3.Options{
		BaseEndpoint: &cfg.Endpoint,
		Region:       cfg.Region,
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		UsePathStyle: cfg.PathStyle,
		// Many S3-compatible stores reject the checksums AWS added beyond what an operation requires.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return &s3Bucket{client: client, name: cfg.Bucket}
}

func (b *s3Bucket) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_, err := b.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        &b.name,
		Key:           &key,
		Body:          r,
		ContentLength: &size,
		ContentType:   &contentType,
	})
	return err
}

func (b *s3Bucket) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	o := &s3Object{ctx: ctx, bucket: b, key: key}
	if err := o.get(0); err != nil {
		return nil, err
	}
	return o, nil
}

func (b *s3Bucket) Delete(ctx context.Context, key string) error {
	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &b.name, Key: &key})
	return err
}

func (b *s3Bucket) Ping(ctx context.Context) error {
	_, err := b.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &b.name})
	return err
}

func (b *s3Bucket) String() string {
	return "s3://" + b.name
}

// s3Object streams an object, asking for the rest anew from wherever a seek moves the next read.
type s3Object struct {
	ctx    context.Context
	bucket *s3Bucket
	key    string
	size   int64
	body   io.ReadCloser
	at     int64 // Where body is
	offset int64 // Where the next read starts
}

func (o *s3Object) get(offset int64) error {
	in := &s3.GetObjectInput{Bucket: &o.bucket.name, Key: &o.key}
	if offset > 0 {
		in.Range = aws.String(fmt.Sprintf("bytes=%d-", offset))
	}
	out, err := o.bucket.client.GetObject(o.ctx, in)
	var missing *types.NoSuchKey
	if errors.As(err, &missing) {
		return &fs.PathError{Op: "open", Path: o.key, Err: fs.ErrNotExist}
	}
	if err != nil {
		return err
	}
	if offset == 0 {
		o.size = aws.ToInt64(out.ContentLength)
	}
	o.body, o.at = out.Body, offset
	return nil
}

func (o *s3Object) Read(p []byte) (int, error) {
	if o.offset >= o.size {
		return 0, io.EOF
	}
	if o.at != o.offset {
		o.body.Close()
		if err := o.get(o.offset); err != nil {
			return 0, err
		}
	}
	n, err := o.body.Read(p)
	o.at += int64(n)
	o.offset = o.at
	return n, err
}

func (o *s3Object) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekCurrent:
		offset += o.offset
	case io.SeekEnd:
		offset += o.size
	}
	if offset < 0 {
		return 0, errors.New("seek before the start of the object")
	}
	o.offset = offset
	return offset, nil
}

func (o *s3Object) Close() error {
	return o.body.Close()
}
