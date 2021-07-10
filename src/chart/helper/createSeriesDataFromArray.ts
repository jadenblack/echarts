/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import * as zrUtil from 'zrender/src/core/util';
import SeriesData from '../../data/SeriesData';
import createDimensions from '../../data/helper/createDimensions';
import {getDimensionTypeByAxis} from '../../data/helper/dimensionHelper';
import {getDataItemValue} from '../../util/model';
import CoordinateSystem from '../../core/CoordinateSystem';
import {getCoordSysInfoBySeries} from '../../model/referHelper';
import { createSourceFromSeriesDataOption, isSourceInstance, Source } from '../../data/Source';
import {enableDataStack} from '../../data/helper/dataStackHelper';
import {makeSeriesEncodeForAxisCoordSys} from '../../data/helper/sourceHelper';
import {
    SOURCE_FORMAT_ORIGINAL, DimensionDefinitionLoose, DimensionDefinition, OptionSourceData, EncodeDefaulter
} from '../../util/types';
import SeriesModel from '../../model/Series';
import DataStorage from '../../data/DataStorage';

function isDataStorage(val: unknown): val is DataStorage {
    return val instanceof DataStorage;
}

function createListFromArray(sourceOrStore: Source | OptionSourceData | DataStorage, seriesModel: SeriesModel, opt?: {
    generateCoord?: string
    useEncodeDefaulter?: boolean | EncodeDefaulter
    // By default: auto. If `true`, create inverted indices for all ordinal dimension on coordSys.
    createInvertedIndices?: boolean
}): SeriesData {
    opt = opt || {};

    if (!isSourceInstance(sourceOrStore) && !isDataStorage(sourceOrStore)) {
        sourceOrStore = createSourceFromSeriesDataOption(sourceOrStore);
    }

    const coordSysName = seriesModel.get('coordinateSystem');
    const registeredCoordSys = CoordinateSystem.get(coordSysName);

    const coordSysInfo = getCoordSysInfoBySeries(seriesModel);

    let coordSysDimDefs: DimensionDefinitionLoose[];

    if (coordSysInfo && coordSysInfo.coordSysDims) {
        coordSysDimDefs = zrUtil.map(coordSysInfo.coordSysDims, function (dim) {
            const dimInfo = {
                name: dim
            } as DimensionDefinition;
            const axisModel = coordSysInfo.axisMap.get(dim);
            if (axisModel) {
                const axisType = axisModel.get('type');
                dimInfo.type = getDimensionTypeByAxis(axisType);
            }
            return dimInfo;
        });
    }

    if (!coordSysDimDefs) {
        // Get dimensions from registered coordinate system
        coordSysDimDefs = (registeredCoordSys && (
            registeredCoordSys.getDimensionsInfo
                ? registeredCoordSys.getDimensionsInfo()
                : registeredCoordSys.dimensions.slice()
        )) || ['x', 'y'];
    }

    const useEncodeDefaulter = opt.useEncodeDefaulter;
    const dimInfoList = createDimensions(
        isDataStorage(sourceOrStore)
            ? sourceOrStore.getSource() : sourceOrStore,
        {
            coordDimensions: coordSysDimDefs,
            generateCoord: opt.generateCoord,
            encodeDefaulter: zrUtil.isFunction(useEncodeDefaulter)
                ? useEncodeDefaulter
                : useEncodeDefaulter
                ? zrUtil.curry(makeSeriesEncodeForAxisCoordSys, coordSysDimDefs, seriesModel)
                : null
        });

    let firstCategoryDimIndex: number;
    let hasNameEncode: boolean;
    coordSysInfo && zrUtil.each(dimInfoList, function (dimInfo, dimIndex) {
        const coordDim = dimInfo.coordDim;
        const categoryAxisModel = coordSysInfo.categoryAxisMap.get(coordDim);
        if (categoryAxisModel) {
            if (firstCategoryDimIndex == null) {
                firstCategoryDimIndex = dimIndex;
            }
            dimInfo.ordinalMeta = categoryAxisModel.getOrdinalMeta();
            if (opt.createInvertedIndices) {
                dimInfo.createInvertedIndices = true;
            }
        }
        if (dimInfo.otherDims.itemName != null) {
            hasNameEncode = true;
        }
    });
    if (!hasNameEncode && firstCategoryDimIndex != null) {
        dimInfoList[firstCategoryDimIndex].otherDims.itemName = 0;
    }

    const stackCalculationInfo = enableDataStack(seriesModel, dimInfoList);

    const data = new SeriesData(dimInfoList, seriesModel);

    data.setCalculationInfo(stackCalculationInfo);

    const dimValueGetter =
        !isDataStorage(sourceOrStore)
        && firstCategoryDimIndex != null
        && isNeedCompleteOrdinalData(sourceOrStore)
            ? function (this: DataStorage, itemOpt: any, dimName: string, dataIndex: number, dimIndex: number) {
                // Use dataIndex as ordinal value in categoryAxis
                return dimIndex === firstCategoryDimIndex
                    ? dataIndex
                    : this.defaultDimValueGetter(itemOpt, dimName, dataIndex, dimIndex);
            }
            : null;

    data.hasItemOption = false;
    data.initData(sourceOrStore, null, dimValueGetter);

    return data;
}

function isNeedCompleteOrdinalData(source: Source) {
    if (source.sourceFormat === SOURCE_FORMAT_ORIGINAL) {
        const sampleItem = firstDataNotNull(source.data as ArrayLike<any> || []);
        return sampleItem != null
            && !zrUtil.isArray(getDataItemValue(sampleItem));
    }
}

function firstDataNotNull(arr: ArrayLike<any>) {
    let i = 0;
    while (i < arr.length && arr[i] == null) {
        i++;
    }
    return arr[i];
}

export default createListFromArray;
