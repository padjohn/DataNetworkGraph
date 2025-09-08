
LAYER_ORDER = ['EdgeLayer', 'ChevronLayer', 'dataPointLayer','boundaryLayer','LabelLayer'];

function getLayerIndex(object) {
  return LAYER_ORDER.indexOf(object.id);
}

function isFontLoaded(fontName) {
  return document.fonts.check(`12px "${fontName}"`);
}

// Function to wait for a font to load
function waitForFont(fontName, maxWait = 500) {
  return new Promise((resolve, reject) => {
      if (isFontLoaded(fontName)) {
          resolve();
      } else {
          const startTime = Date.now();
          const interval = setInterval(() => {
              if (isFontLoaded(fontName)) {
                  clearInterval(interval);
                  resolve();
              } else if (Date.now() - startTime > maxWait) {
                  clearInterval(interval);
                  reject(new Error(`Font ${fontName} did not load within ${maxWait}ms`));
              }
          }, 50);
      }
  });
}

function getInitialViewportSize() {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  
  return { viewportWidth: width, viewportHeight: height };
}

function calculateZoomLevel(bounds, viewportWidth, viewportHeight, padding = 0.5) {
  // Calculate the range of the bounds
  const lngRange = bounds[1] - bounds[0];
  const latRange = bounds[3] - bounds[2];

  // Calculate the center of the bounds
  const centerLng = (bounds[0] + bounds[1]) / 2;
  const centerLat = (bounds[2] + bounds[3]) / 2;

  // Calculate the zoom level for both dimensions
  const zoomX = Math.log2(360 / (lngRange / (viewportWidth / 256)));
  const zoomY = Math.log2(180 / (latRange / (viewportHeight / 256)));

  const zoom = Math.min(zoomX, zoomY) - padding;

  return { zoomLevel: zoom, dataCenter: [centerLng, centerLat] };
}

class DataMap {
  constructor({
    container,
    bounds,
    searchItemId = "text-search",
    lassoSelectionItemId = "lasso-selection",
  }) {
    this.container = container;
    this.searchItemId = searchItemId;
    this.lassoSelectionItemId = lassoSelectionItemId;
    this.pointData = null;
    this.edgeData = null;
    this.metaData = null;
    this.layers = [];
    const { viewportWidth, viewportHeight } = getInitialViewportSize();
    const { zoomLevel, dataCenter } = calculateZoomLevel(bounds, viewportWidth, viewportHeight);
    this.deckgl = new deck.DeckGL({
      container: container,
      initialViewState: {
        latitude: dataCenter[1],
        longitude: dataCenter[0],
        zoom: zoomLevel
      },
      controller: { scrollZoom: { speed: 0.01, smooth: true } },
    });
    this.updateTriggerCounter = 0;
    this.dataSelectionManager = new DataSelectionManager(lassoSelectionItemId);
  }

  addPoints(pointData, {
    pointSize,
    pointOutlineColor = [250, 250, 250, 128],
    pointLineWidth = 0.001,
    pointHoverColor = [170, 0, 0, 187],
    pointLineWidthMaxPixels = 3,
    pointLineWidthMinPixels = 0.001,
    pointRadiusMaxPixels = 16,
    pointRadiusMinPixels = 0.2,
  }) {
    // Parse out and reformat data for deck.gl
    const numPoints = pointData.x.length;
    const positions = new Float32Array(numPoints * 2);
    const colors = new Uint8Array(numPoints * 4);
    const connectedArrays = [];
    const variableSize = pointSize < 0;
    let sizes;
    if (variableSize) {
      sizes = new Float32Array(numPoints);
    } else {
      sizes = null;
    }
    console.log("Raw Point Data Connections:", pointData.connections);

    // Populate the arrays
    for (let i = 0; i < numPoints; i++) {
      positions[i * 2] = pointData.x[i];
      positions[i * 2 + 1] = pointData.y[i];
      colors[i * 4] = pointData.r[i];
      colors[i * 4 + 1] = pointData.g[i];
      colors[i * 4 + 2] = pointData.b[i];
      colors[i * 4 + 3] = pointData.a[i];
      if (variableSize) {
        sizes[i] = pointData.size[i];
      }
      // Extract connections
      if (pointData.connections) {
        connectedArrays[i] = pointData.connections[i];
      }
    }
    this.connectedArrays = connectedArrays;
    this.selected = new Float32Array(numPoints).fill(1.0);
    this.pointSize = pointSize;
    this.pointOutlineColor = pointOutlineColor;
    this.pointLineWidth = pointLineWidth;
    this.pointHoverColor = pointHoverColor;
    this.pointLineWidthMaxPixels = pointLineWidthMaxPixels;
    this.pointLineWidthMinPixels = pointLineWidthMinPixels;
    this.pointRadiusMaxPixels = pointRadiusMaxPixels;
    this.pointRadiusMinPixels = pointRadiusMinPixels;

    let scatterAttributes = {
      getPosition: { value: positions, size: 2 },
      getFillColor: { value: colors, size: 4 },
      getFilterValue: { value: this.selected, size: 1 }
    };
    if (variableSize) {
      scatterAttributes.getRadius = { value: sizes, size: 1 };
    }

    this.pointLayer = new deck.ScatterplotLayer({
      id: 'dataPointLayer',
      data: {
        length: numPoints,
        attributes: scatterAttributes
      },
      getRadius: this.pointSize,
      getLineColor: this.pointOutlineColor,
      getLineWidth: this.pointLineWidth,
      highlightColor: this.pointHoverColor,
      lineWidthMaxPixels: this.pointLineWidthMaxPixels,
      lineWidthMinPixels: this.pointLineWidthMinPixels,
      radiusMaxPixels: this.pointRadiusMaxPixels,
      radiusMinPixels: this.pointRadiusMinPixels,
      radiusUnits: "common",
      lineWidthUnits: "common",
      autoHighlight: true,
      pickable: true,
      stroked: true,
      extensions: [new deck.DataFilterExtension({ filterSize: 1 })],
      filterRange: [-0.5, 1.5],
      filterSoftRange: [0.75, 1.25],
      updateTriggers: {
        getFilterValue: this.updateTriggerCounter  // We'll increment this to trigger updates
      },
      instanceCount: numPoints,
      parameters: {
        depthTest: false
      }
    });

    this.layers.push(this.pointLayer);
    this.layers.sort((a, b) => getLayerIndex(a) - getLayerIndex(b));
    this.deckgl.setProps({ layers: [...this.layers] });
    console.log(`Added ${pointData.x.length} Points: ${pointData}`);
    console.log("First Connection Object:", this.connectedArrays[0]);
    console.log("Connections for Point 1:", this.connectedArrays[1]);
  }

  addEdges(edgeData, nodePositions, {
    edgeWidthMinPixels = 1,
    edgeWidthMaxPixels = 10,
    edgeWidthUnits = "pixels",
    pickable = false,
    chevronSpacing = 0.05, // Adjust spacing between chevrons
  }) {
    const numEdges = edgeData.source_index.length;
    console.log(`Added ${numEdges} Edges | Assigning Positions based on ${nodePositions.length / 2} Points`);
  
    const sourcePositions = new Float32Array(numEdges * 2);
    const targetPositions = new Float32Array(numEdges * 2);
    const widths = new Float32Array(numEdges);
    const chevronMarkers = []; // To store marker positions and rotations
  
    for (let i = 0; i < numEdges; i++) {
      const sourceIndex = Number(edgeData.source_index[i]);
      const targetIndex = Number(edgeData.target_index[i]);
  
      if (sourceIndex === undefined || targetIndex === undefined) {
        console.error(`Edge at index ${i} has invalid indices: source_index=${sourceIndex}, target_index=${targetIndex}`);
        continue;
      }
  
      const x1 = nodePositions[sourceIndex * 2];
      const y1 = nodePositions[sourceIndex * 2 + 1];
      const x2 = nodePositions[targetIndex * 2];
      const y2 = nodePositions[targetIndex * 2 + 1];
  
      sourcePositions[i * 2] = x1;
      sourcePositions[i * 2 + 1] = y1;
      targetPositions[i * 2] = x2;
      targetPositions[i * 2 + 1] = y2;
      widths[i] = edgeData.width[i] || edgeWidthMinPixels;
  
      // Generate chevrons periodically along the line
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const numMarkers = Math.max(Math.floor(distance / chevronSpacing), 1);
      //console.log(`numMarkers: ${numMarkers} `)
      //console.log(`Edge ${i} distance: ${distance} | dx:${dx}, dy:${dy} | x1:${x1}, x2:${x2}, y1:${y1}, y2:${y2} `)
  
      for (let j = 1; j < numMarkers; j++) {
        const t = j / numMarkers;
        const mx = x1 + t * dx;
        const my = y1 + t * dy;
  
        chevronMarkers.push({
          position: [mx, my],
          angle: angle,
          symbol: '>',
          edgeIndex: i,
        });
      }
    }
  
    // Create LineLayer for edges
    this.edgeLayer = new deck.LineLayer({
      id: 'EdgeLayer',
      data: { length: numEdges },
      getSourcePosition: (_, { index }) => [
        sourcePositions[index * 2],
        sourcePositions[index * 2 + 1],
      ],
      getTargetPosition: (_, { index }) => [
        targetPositions[index * 2],
        targetPositions[index * 2 + 1],
      ],
      getWidth: (_, { index }) => widths[index],
      getColor: (_, { index }) => [128, 128, 128, 128],
      widthUnits: edgeWidthUnits,
      widthMinPixels: edgeWidthMinPixels,
      widthMaxPixels: edgeWidthMaxPixels,
      pickable: pickable,
      parameters: {
        depthTest: false,
      },
    });
  
    // Create TextLayer for chevrons
    this.chevronLayer = new deck.TextLayer({
      id: 'ChevronLayer',
      data: chevronMarkers,
      getPosition: d => d.position,
      getText: d => d.symbol,
      getSize: 12, // Adjust size for visibility
      getColor: (_, { index }) => [100, 100, 100, 255], // Chevron color
      getAngle: d => d.angle,
      sizeMinPixels: 8,
      sizeMaxPixels: 8,
      sizeUnits: 'pixels',
      fontFamily: 'Arial',
      fontWeight: 900,
      characterSet: ['>'],
      pickable: false,
      parameters: {
        depthTest: false,
      },
    });
  
    // Add layers to the layers array
    this.layers.push(this.edgeLayer, this.chevronLayer);
    this.layers.sort((a, b) => getLayerIndex(a) - getLayerIndex(b));
    this.deckgl.setProps({ layers: [...this.layers] });
  
    console.log(`Edge and Chevron layers successfully created with ${numEdges} edges and ${chevronMarkers.length} markers.`);
  }

  addLabels(labelData, {
    labelTextColor = d => [d.r, d.g, d.b],
    textMinPixelSize = 18,
    textMaxPixelSize = 36,
    textOutlineWidth = 8,
    textOutlineColor = [238, 238, 238, 221],
    textBackgroundColor = [255, 255, 255, 64],
    fontFamily = "Roboto",
    fontWeight = 500,
    lineSpacing = 0.95,
    textCollisionSizeScale = 3.0,
  }) {
    const numLabels = labelData.length;
    this.labelTextColor = labelTextColor;
    this.textMinPixelSize = textMinPixelSize;
    this.textMaxPixelSize = textMaxPixelSize;
    this.textOutlineWidth = textOutlineWidth;
    this.textOutlineColor = textOutlineColor;
    this.textBackgroundColor = textBackgroundColor;
    this.fontFamily = fontFamily;
    this.fontWeight = fontWeight;
    this.lineSpacing = lineSpacing;
    this.textCollisionSizeScale = textCollisionSizeScale;

    waitForFont(this.fontFamily);

    this.labelLayer = new deck.TextLayer({
      id: 'LabelLayer',
      data: labelData,
      pickable: false,
      getPosition: d => [d.x, d.y],
      getText: d => d.label,
      getColor: this.labelTextColor,
      getSize: d => d.size,
      sizeScale: 1,
      sizeMinPixels: this.textMinPixelSize,
      sizeMaxPixels: this.textMaxPixelSize,
      outlineWidth: this.textOutlineWidth,
      outlineColor: this.textOutlineColor,
      getBackgroundColor: this.textBackgroundColor,
      getBackgroundPadding: [15, 15, 15, 15],
      background: true,
      characterSet: "auto",
      fontFamily: this.fontFamily,
      fontWeight: this.fontWeight,
      lineHeight: this.lineSpacing,
      fontSettings: { "sdf": true },
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      lineHeight: 0.95,
      elevation: 100,
      // CollideExtension options
      collisionEnabled: true,
      getCollisionPriority: d => d.size,
      collisionTestProps: {
        sizeScale: this.textCollisionSizeScale,
        sizeMaxPixels: this.textMaxPixelSize * 2,
        sizeMinPixels: this.textMinPixelSize * 2
      },
      extensions: [new deck.CollisionFilterExtension()],
      instanceCount: numLabels,
      parameters: {
        depthTest: false
      }
    });

    this.layers.push(this.labelLayer);
    this.layers.sort((a, b) => getLayerIndex(a) - getLayerIndex(b));
    this.deckgl.setProps({ layers: [...this.layers] });
  }

  addBoundaries(boundaryData, {clusterBoundaryLineWidth = 0.5}) {
    const numBoundaries = boundaryData.length;
    this.clusterBoundaryLineWidth = clusterBoundaryLineWidth;

    this.boundaryLayer = new deck.PolygonLayer({
      id: 'boundaryLayer',
      data: boundaryData,
      stroked: true,
      filled: false,
      getLineColor: d => [d.r, d.g, d.b, d.a],
      getPolygon: d => d.polygon,
      lineWidthUnits: "common",
      getLineWidth: d => d.size * d.size,
      lineWidthScale: this.clusterBoundaryLineWidth * 5e-5,
      lineJointRounded: true,
      lineWidthMaxPixels: 4,
      lineWidthMinPixels: 0.0,
      instanceCount: numBoundaries,
      parameters: {
        depthTest: false
      }
    });

    this.layers.push(this.boundaryLayer);
    this.layers.sort((a, b) => getLayerIndex(a) - getLayerIndex(b));
    this.deckgl.setProps({ layers: [...this.layers] });
  }

  addMetaData(metaData, {
    tooltipFunction = ({index}) => this.metaData.hover_text[index],
    onClickFunction = null,
    searchField = null,

  }) {
    this.metaData = metaData;
    this.tooltipFunction = tooltipFunction;
    this.onClickFunction = onClickFunction;
    this.searchField = searchField;    

    // If hover_text is present, add a tooltip
    if (this.metaData.hasOwnProperty('hover_text')) {
      this.deckgl.setProps({
        getTooltip: this.tooltipFunction,
      });
    }

    if (this.onClickFunction) {
      this.deckgl.setProps({
        onClick: this.onClickFunction,
      });
    }

    //  if search is enabled, add search data array
    if (this.searchField) {
      this.searchArray = this.metaData[this.searchField].map(d => d.toLowerCase());
    }
  }

  connectHistogram(histogramItem) {
    this.histogramItem = histogramItem;
    this.histogramItemId = histogramItem.state.chart.chartContainerId;
  }

  highlightPoints(itemId) {
    const selectedIndices = this.dataSelectionManager.getSelectedIndices();
    const semiSelectedIndices = this.dataSelectionManager.getBasicSelectedIndices();
    const hasSelectedIndices = selectedIndices.size !== 0;
    const hasSemiSelectedIndices = semiSelectedIndices.size !== 0;
    const hasLassoSelection = this.dataSelectionManager.hasSpecialSelection();
    this.selectedEdges = new Float32Array(this.edgeLayer.props.data.length).fill(0);
  
    // Update selected array
    if (hasLassoSelection) {
      if (hasSelectedIndices) {
        if (hasSemiSelectedIndices) {
          this.selected.fill(-1.0);
          for (let i of semiSelectedIndices) {
            this.selected[i] = 0.0;
          }
        } else {
          this.selected.fill(0.0);
        }
        for (let i of selectedIndices) {
          this.selected[i] = 1.0;
  
          const connections = this.connectedArrays[i];
          if (connections) {
            for (const connection of connections) {
              this.selected[connection.connected_node] = 1.0;
            }
            console.log("Selected Connections:", this.connectedArrays[i]);
          }
        }
      } else {
        this.selected.fill(1.0);
      }
    } else {
      if (hasSelectedIndices) {
        this.selected.fill(-1.0);
        for (let i of selectedIndices) {
          this.selected[i] = 1.0;
          // Access connections from connectedArrays
          const connections = this.connectedArrays[i];
          if (connections && connections.data) {
            const children = connections.data[0].children;
            if (children) {
              const connectedNodes = children[0]?.values || [];
              const edges = children[1]?.values || [];

              // Iterate through connections and mark nodes
              for (let j = 0; j < connections.length; j++) {
                const connectedNode = connectedNodes[j] ? Number(connectedNodes[j]) : null;
                const edge = edges[j] ? Number(edges[j]) : null;
              
                if (connectedNode !== null) {
                  this.selected[connectedNode] = 1.0; // Mark connected nodes
                  if (edge !== null) {
                    this.selectedEdges[edge] = 1; // Mark connected edges
                  }
                  //console.log(`Connected Node: ${connectedNode}, Edge: ${edge}`);
                }
              }
            }
          }
        }
        
      } else {
        this.selected.fill(1.0);
        this.selectedEdges.fill(1);
      }
    }
  
    // Increment update trigger
    this.updateTriggerCounter++;
    console.log("Update Trigger Counter Incremented:", this.updateTriggerCounter);
  
    // Points
    const sizeAdjust = 1 / (1 + (Math.sqrt(selectedIndices.size) / Math.log2(this.selected.length))); 
    const updatedPointLayer = this.pointLayer.clone({
      data: {
        ...this.pointLayer.props.data,
        attributes: {
          ...this.pointLayer.props.data.attributes,
          getFilterValue: { value: this.selected, size: 1 }
        }
      },
      radiusMinPixels: hasSelectedIndices
        ? 2 * (this.pointRadiusMinPixels + sizeAdjust)
        : this.pointRadiusMinPixels,
      updateTriggers: {
        getFilterValue: this.updateTriggerCounter,
        radiusMinPixels: this.updateTriggerCounter
      }
    });

  // Labels
  const updatedLabelLayer = this.labelLayer.clone({
    data: this.labelLayer.props.data.map((label, index) => {
      const isMainSelected = selectedIndices.has(index);
      const isVisible = this.selected[index] === 1.0;
  
      // Debugging each label's status
      /*
      console.log(
        `Label ${index}: visible=${isVisible}, isMainSelected=${isMainSelected}, ` +
        `label="${label.label}", size=${label.size}`
      );
      */
  
      return {
        ...label,
        visible: isVisible,
        isMainSelected,
      };
    }),
    getText: d => (d.visible ? d.label : ""),
    getSize: d => (d.visible ? (d.isMainSelected ? d.size * 4 : d.size) : 0),
    getCollisionPriority: d => {
      // Debug collision priority
      const priority = d.visible ? (d.isMainSelected ? 500 : d.size) : 0;
      /*
      console.log(
        `Label "${d.label}" collision priority=${priority} (visible=${d.visible}, mainSelected=${d.isMainSelected})`
      );
      */
      return priority;
    },
    getFontWeight: d => (d.isMainSelected ? 900 : this.fontWeight),
    updateTriggers: {
      getText: this.updateTriggerCounter,
      getSize: this.updateTriggerCounter,
      getCollisionPriority: this.updateTriggerCounter,
      getFontWeight: this.updateTriggerCounter,
    },
  });


  // Edges
  const updatedEdgeLayer = this.edgeLayer.clone({
    getColor: (_, { index }) => {
      const isSelected = this.selectedEdges[index] === 1.0;
      const [r, g, b, originalAlpha] = this.edgeLayer.props.getColor(_, { index });
  
      const alpha = isSelected ? originalAlpha : 0;
      //console.log(`Edge ${index}: selected=${isSelected}, alpha=${alpha}`);
  
      return [r, g, b, alpha];
    },
    updateTriggers: {
      getColor: this.updateTriggerCounter,
    },
  });

  const updatedChevronLayer = this.chevronLayer.clone({
    data: this.chevronLayer.props.data.map((marker) => ({
      ...marker,
      visible: this.selectedEdges[marker.edgeIndex] === 1.0,
    })),
    getText: d => (d.visible ? d.symbol : ""),
    updateTriggers: {
      getText: this.updateTriggerCounter,
    },
  });
  
  console.log('Updated Edge Layer:', updatedEdgeLayer);

  const edgeLayerIdx = this.layers.indexOf(this.edgeLayer);
  const chevronLayerIdx = this.layers.indexOf(this.chevronLayer);
  const pointLayerIdx = this.layers.indexOf(this.pointLayer);
  const labelLayerIdx = this.layers.indexOf(this.labelLayer);

  this.deckgl.setProps({
    layers: [
      ...this.layers.slice(0, edgeLayerIdx),
      updatedEdgeLayer,
      ...this.layers.slice(edgeLayerIdx + 1, chevronLayerIdx),
      updatedChevronLayer,
      ...this.layers.slice(chevronLayerIdx + 1, pointLayerIdx),
      updatedPointLayer,
      ...this.layers.slice(pointLayerIdx + 1, labelLayerIdx),
      updatedLabelLayer,
      ...this.layers.slice(labelLayerIdx + 1),
    ],
  });
  
  console.log('Layers Array in setProps:', this.layers);
  
    // Update histogram, if any
    if (this.histogramItem && itemId !== this.histogramItemId) {
      if (hasSelectedIndices) {
        this.histogramItem.drawChartWithSelection(selectedIndices);
      } else {
        this.histogramItem.removeChartWithSelection(selectedIndices);
      }
    }
  }

  addSelection(selectedIndices, selectionKind) {
    this.dataSelectionManager.addOrUpdateSelectedIndicesOfItem(selectedIndices, selectionKind);
    this.highlightPoints(selectionKind);
  }

  removeSelection(selectionKind) {
    this.dataSelectionManager.removeSelectedIndicesOfItem(selectionKind);
    this.highlightPoints(selectionKind);
  }

  getSelectedIndices() {
    return this.dataSelectionManager.getSelectedIndices();
  }

  searchText(searchTerm) {
    const searchTermLower = searchTerm.toLowerCase();
    const selectedIndices = this.searchArray.reduce((indices, d, i) => {
      if (d.indexOf(searchTermLower) >= 0) {
        indices.push(i);
      }
      return indices;
    }, []);
    if (searchTerm === "") {
      this.dataSelectionManager.removeSelectedIndicesOfItem(this.searchItemId);
    } else {
      this.dataSelectionManager.addOrUpdateSelectedIndicesOfItem(selectedIndices, this.searchItemId);
    }
    this.highlightPoints(this.searchItemId);
  }
}