const MapboxGeocoder = require('@mapbox/mapbox-gl-geocoder');
const mapboxgl = require('mapbox-gl');
const tilebelt = require('@mapbox/tilebelt');
const tc = require('@mapbox/tile-cover');

mapboxgl.accessToken = 'pk.eyJ1IjoiYmVuamFtaW50ZCIsImEiOiJjaW83enIwNjYwMnB1dmlsejN6cDBzbm93In0.0ZOGwSLp8OjW6vCaEKYFng';

var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/benjamintd/cjmt1av8w1dto2so7ijtr4b67',
  center: [0, 25],
  zoom: 1.3
});

var geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken
});

map.addControl(geocoder);

class QuadkeySearchControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl';
        this._container.innerHTML = `
          <div id='tilesearch'>
            Quadkey search:
            <span id='editable' contenteditable='true'>12</span>
            <button id='search'>Search</button>
          </div>
        `;
        return this._container;
    }

    onRemove() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

var quadkeySearchControl = new QuadkeySearchControl();

map.addControl(quadkeySearchControl, 'top-left');

map.on('load', () => {
  map.addSource('tiles-geojson', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addSource('tiles-centers-geojson', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: []
    }
  });

  map.addLayer({
    id: 'tiles',
    source: 'tiles-geojson',
    type: 'line',
    paint: {
      'line-color': '#000'
    }
  });

  map.addLayer({
    id: 'tiles-shade',
    source: 'tiles-geojson',
    type: 'fill',
    paint: {
      'fill-color': ['case', ['get', 'even'], 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0)']
    }
  });

  map.addLayer({
    id: 'tiles-centers',
    source: 'tiles-centers-geojson',
    type: 'symbol',
    layout: {
      'text-field': ['format', ['get', 'text'], { 'font-scale': 1.2 }],
      'text-offset': [0, -1],
    },
    paint: {
      'text-color': '#000',
      'text-color-transition': {
        duration: 0
      },
      'text-halo-color': '#fff',
      'text-halo-width': 0.5
    }
  });

  update();
});

map.on('moveend', update);

map.on('click', (e) => {
  features = map.queryRenderedFeatures(e.point, {layers: ['tiles-shade']});
  copyToClipboard(features[0].properties.quadkey)
  showSnackbar()
})

function updateGeocoderProximity() {
  // proximity is designed for local scale, if the user is looking at the whole world,
  // it doesn't make sense to factor in the arbitrary centre of the map
  if (map.getZoom() > 9) {
    var center = map.getCenter().wrap(); // ensures the longitude falls within -180 to 180 as the Geocoding API doesn't accept values outside this range
    geocoder.setProximity({ longitude: center.lng, latitude: center.lat });
  } else {
    geocoder.setProximity(null);
  }
}

function update() {
  updateGeocoderProximity();
  updateTiles();
}

function updateTiles() {
  var extentsGeom = getExtentsGeom();
  var zoom = Math.ceil(map.getZoom());
  tiles = tc.tiles(extentsGeom, {min_zoom: zoom, max_zoom: zoom});

  map.getSource('tiles-geojson').setData({
    type: 'FeatureCollection',
    features: tiles.map(getTileFeature)
  });

  map.getSource('tiles-centers-geojson').setData({
    type: 'FeatureCollection',
    features: tiles.map(getTileCenterFeature)
  });
}

function getExtentsGeom() {
  var e = map.getBounds();
  var box = [
    e.getSouthWest().toArray(),
    e.getNorthWest().toArray(),
    e.getNorthEast().toArray(),
    e.getSouthEast().toArray(),
    e.getSouthWest().toArray()
  ].map(coords => {
    if (coords[0] < -180) return [-179.99999, coords[1]]
    if (coords[0] > 180) return [179.99999, coords[1]]
    return coords
  });

  return {
    type: 'Polygon',
    coordinates: [box]
  };
}

// bind op to search button, top left
document.getElementById('search').onclick = function navToQuadkey() {
  const button = document.getElementById('search');
  console.log(button.parentElement.firstElementChild.textContent);
  console.log(tilebelt.quadkeyToTile(button.parentElement.firstElementChild.textContent));

  try {
    // convert qk to a tile to leverage helper func
    const qkGeo = tilebelt.tileToGeoJSON(
      tilebelt.quadkeyToTile(
        button.parentElement.firstElementChild.textContent.toString()));
    const qkBbox = [qkGeo.coordinates[0][0], qkGeo.coordinates[0][2]];
    console.log(qkBbox);
    map.fitBounds(qkBbox, {padding: {top: 200, bottom: 200, left: 200, right: 200}});
  } catch (e) {
    // Bad quadkey?
    console.log(e);
  }
};

function getTileFeature(tile) {
  var quadkey = tilebelt.tileToQuadkey(tile);

  var feature = {
    type: 'Feature',
    properties: {
      even: ((tile[0] + tile[1]) % 2 == 0),
      quadkey: quadkey
    },
    geometry: tilebelt.tileToGeoJSON(tile)
  };
  return feature;
}

function getTileCenterFeature(tile) {
  var box = tilebelt.tileToBBOX(tile);
  var center = [
    (box[0] + box[2]) / 2,
    (box[1] + box[3]) / 2
  ];

  var quadkey = tilebelt.tileToQuadkey(tile);

  return {
    type: 'Feature',
    properties: {
      text: 'Tile: ' + JSON.stringify(tile) + '\nQuadkey: ' + quadkey + '\nZoom: ' + tile[2],
      quadkey: quadkey
    },
    geometry: {
      type: 'Point',
      coordinates: center
    }
  };
}

function copyToClipboard(str) {
  const el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}


function showSnackbar() {
    var x = document.getElementById('snackbar');
    x.className = 'show';
    setTimeout(function(){ x.className = x.className.replace('show', ''); }, 2000);
}
