"""Fetch public OSM detail once; no player data is sent. Cache for offline play."""
import json, urllib.request, urllib.parse, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parent
bbox='37.3275,-121.897,37.357,-121.8605'
query=f'''[out:json][timeout:60];(node[highway~"^(traffic_signals|crossing|stop)$"]({bbox});node[natural=tree]({bbox});way[highway~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|unclassified|footway|path|pedestrian)$"]({bbox}););out body geom;'''
request=urllib.request.Request('https://overpass-api.de/api/interpreter',data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'HometownGrandPrix-local-prototype/0.2','Content-Type':'application/x-www-form-urlencoded'})
with urllib.request.urlopen(request,timeout=90) as r: data=json.load(r)
if not data.get('elements'):raise RuntimeError('No map details returned')
data['downloaded_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
data['source']='https://overpass-api.de/api/interpreter'
output=ROOT/'map-cache'/'san-jose-details.json'
output.write_text(json.dumps(data,separators=(',',':')))
print('Cached',len(data['elements']),'OSM elements;',output.stat().st_size,'bytes')
