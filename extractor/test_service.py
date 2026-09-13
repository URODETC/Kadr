import time
import unittest
from types import SimpleNamespace
from fastapi.testclient import TestClient
import service

class MockSource:
    title = 'Японский с субтитрами'
    url = 'https://player.example/episode'
    async def a_get_videos(self):
        return [SimpleNamespace(url='https://cdn.example/1080.m3u8', quality=1080, type='m3u8', headers={})]
class MockEpisode:
    title = 'Начало'
    ordinal = 1
    async def a_get_sources(self):
        return [MockSource()]
class MockAnime:
    title = 'Тестовое аниме'
    description = 'Описание'
    async def a_get_episodes(self):
        return [MockEpisode()]
class MockSearch:
    title = 'Тестовое аниме'
    thumbnail = '/poster.jpg'
    url = '/anime/1'
    async def a_get_anime(self):
        return MockAnime()
class MockExtractor:
    BASE_URL = 'https://anime.example'
    async def a_search(self, q):
        return [MockSearch()]
    async def a_ongoing(self):
        return [MockSearch()]

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.old = service.extractors.copy()
        service.extractors['animego'] = MockExtractor()
        service.registry = service.Registry()
        self.client = TestClient(service.app)
        self.headers = {'X-User-Id': '1'}
    def tearDown(self):
        service.extractors.clear()
        service.extractors.update(self.old)
        self.client.close()
    def get(self,path):
        r = self.client.get(path,headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()
    def test_complete_pipeline_and_owner_isolation(self):
        found=self.get('/search/animego?q=test')['items'][0]
        self.assertEqual(found['thumbnail'],'https://anime.example/poster.jpg')
        self.assertNotIn('url',found)
        self.assertEqual(self.client.get('/anime/'+found['id'],headers={'X-User-Id':'2'}).status_code,410)
        anime=self.get('/anime/'+found['id'])
        sources=self.get('/sources/'+anime['episodes'][0]['id'])
        self.assertEqual(sources['items'][0]['title'],'Японский с субтитрами')
        playback=self.get('/playback/'+sources['items'][0]['id'])
        self.assertEqual(playback['sources'][0]['quality'],1080)
        self.assertEqual(playback['subtitles'],[]) # Do not invent external subtitle files.
    def test_no_public_access_or_arbitrary_urls(self):
        self.assertEqual(self.client.get('/providers').status_code,401)
        self.assertEqual(self.client.get('/search/not_a_module',headers=self.headers).status_code,404)
        self.assertEqual(self.client.get('/playback/arbitrary',headers=self.headers).status_code,410)
        for url in ['http://127.0.0.1/x','http://[::1]/','http://169.254.169.254/','file:///etc/passwd','https://u:p@example.com','javascript:alert(1)']:
            self.assertEqual(service.public_url(url),'')
    def test_expiry_and_wrong_handle_kind(self):
        key=service.registry.put('1','search',MockSearch(),'animego')
        self.assertEqual(self.client.get('/sources/'+key,headers=self.headers).status_code,410)
        service.registry.items[key].expires=time.monotonic()-1
        self.assertEqual(self.client.get('/anime/'+key,headers=self.headers).status_code,410)
    def test_sort_quality_and_reject_required_headers(self):
        def video(q,headers=None,url='https://cdn.example/video'):
            return SimpleNamespace(url=url,quality=q,type='mp4',headers=headers or {})
        items,blocked=service.normalize_videos([video(480),video(1080),video(720,{'Referer':'secret'}),video(1080,url='http://10.0.0.1/')])
        self.assertEqual([i['quality'] for i in items],[1080,480])
        self.assertEqual(blocked,1)
        self.assertNotIn('secret',str(items))
    def test_provider_failure_is_sanitized(self):
        class Broken(MockExtractor):
            async def a_search(self,q):
                raise RuntimeError('https://provider/?sid=secret')
        service.extractors['animego']=Broken()
        r=self.client.get('/search/animego?q=broken',headers=self.headers)
        self.assertEqual(r.status_code,502)
        self.assertNotIn('secret',r.text)

if __name__=='__main__':unittest.main()
