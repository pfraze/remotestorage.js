var rshost = servware();
local.addServer('localpage', rshost);

rshost.route('/.well-known/host-meta.json', function(link, method) {
	method('GET', function(req, res) {
		return [200, {
			"links": [{
				"href": "httpl://localpage/storage/pfraze",
				"rel": "remotestorage",
				"type": "draft-dejong-remotestorage-02",
				"properties": {
					"auth-method": "http://tools.ietf.org/html/rfc6749#section-4.2",
					"auth-endpoint": "http://remotestorage.grimwire.com/oauth/pfraze",
					"http://remotestorage.io/spec/version": "draft-dejong-remotestorage-02",
					"http://tools.ietf.org/html/rfc6749#section-4.2": "http://remotestorage.grimwire.com/oauth/pfraze"
				}
			}]
		}];
	});
});

rshost.route('/storage/pfraze/notes', function(link, method) {
	method('GET', function() {
		return [200, { "note.txt": "1383849337000" }];
	});
});

rshost.route('/storage/pfraze/notes/note.txt', function(link, method) {
	method('GET', function() {
		return [200, localStorage.getItem('note.txt')];
	});
	method('PUT', function(req) {
		localStorage.setItem('note.txt', req.body);
		return 200;
	});
});