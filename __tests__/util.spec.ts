import { describe, it, expect } from 'vitest'
import { camelize } from '../src/util'

describe('camelize', () => {
  it('应该将连字符分隔的字符串转换为驼峰命名', () => {
    expect(camelize('hello-world')).toBe('helloWorld')
    expect(camelize('hello-world-test')).toBe('helloWorldTest')
  })

  it('应该将下划线分隔的字符串转换为驼峰命名', () => {
    expect(camelize('hello_world')).toBe('helloWorld')
    expect(camelize('hello_world_test')).toBe('helloWorldTest')
  })

  it('应该将空格分隔的字符串转换为驼峰命名', () => {
    expect(camelize('hello world')).toBe('helloWorld')
    expect(camelize('hello world test')).toBe('helloWorldTest')
  })

  it('应该处理混合分隔符的情况', () => {
    expect(camelize('hello-world_test')).toBe('helloWorldTest')
    expect(camelize('hello_world-test')).toBe('helloWorldTest')
    expect(camelize('hello world-test')).toBe('helloWorldTest')
  })

  it('应该处理空字符串', () => {
    expect(camelize('')).toBe('')
  })

  it('应该处理已经是驼峰命名的字符串', () => {
    expect(camelize('helloWorld')).toBe('helloWorld')
  })

  it('应该正确处理包含数字的字符串', () => {
    expect(camelize('hello-123-world')).toBe('hello123World')
    expect(camelize('hello_123_world')).toBe('hello123World')
    expect(camelize('hello 123 world')).toBe('hello123World')
    expect(camelize('123-hello-world')).toBe('123HelloWorld')
    expect(camelize('hello-world-123')).toBe('helloWorld123')
    expect(camelize('hello-123-456-world')).toBe('hello123456World')
  })
}) 
